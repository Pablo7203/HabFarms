import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "@/lib/env";
import { desktopStagingTargetIsVerified } from "@/lib/desktop/http";
import { dbFor, canonicalRefresh } from "@/lib/desktop/server";
import { dailyProductionV1, mortalityV1, type DesktopOperationV1 } from "@/lib/desktop/sync-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBodyBytes = 128 * 1024;
const allowedOrigins = new Set([
  "tauri://localhost", "http://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420",
]);
const requestSchema = z.strictObject({
  protocolVersion: z.literal(1),
  appVersion: z.string().trim().min(1).max(32),
  localSchemaVersion: z.literal(4),
  installationId: z.uuid(),
  farmId: z.uuid(),
  operations: z.array(z.discriminatedUnion("operationType", [mortalityV1, dailyProductionV1])).min(1).max(20),
});
type Outcome = { operationId: string; code: string; receipt?: unknown; message?: string };

function response(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin") ?? "";
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
  if (allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization,content-type");
    headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  }
  return Response.json(body, { status, headers });
}

function outcomeForError(operation: DesktopOperationV1, error: { code?: string; message?: string }): Outcome {
  const detail = error.message ?? "";
  if (/Operation ID reused/i.test(detail)) return { operationId: operation.operationId, code: "OPERATION_ID_REUSED", message: "This operation ID was already used with different information." };
  if (/already exists/i.test(detail)) return { operationId: operation.operationId, code: "DAILY_PRODUCTION_EXISTS", message: "Production already exists for this flock and date. Review the web record before correcting this entry." };
  if (error.code === "42501" || /access denied|authentication required/i.test(detail)) return { operationId: operation.operationId, code: "AUTHORIZATION_FAILED", message: "Current farm access does not permit this entry to sync. Your local entry is preserved." };
  if (error.code === "23505") return { operationId: operation.operationId, code: "CONFLICT", message: "A matching business record already exists. Review it in HabFarms before correcting this entry." };
  if (["22023", "23514", "23503", "22P02"].includes(error.code ?? "")) return { operationId: operation.operationId, code: "VALIDATION_FAILED", message: "HabFarms rejected this entry under its current business rules. Your local entry is preserved." };
  return { operationId: operation.operationId, code: "RETRYABLE_FAILURE", message: "HabFarms could not confirm this entry. It remains queued and can be retried safely." };
}

export async function GET(request: Request) {
  if (!desktopStagingTargetIsVerified()) return response(request, { status: "target_mismatch" }, 503);
  try {
    const upstream = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      cache: "no-store", signal: AbortSignal.timeout(3500),
    });
    if (!upstream.ok) return response(request, { status: "unreachable" });
    const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
    const local = ["localhost", "127.0.0.1", "::1"].includes(host);
    return response(request, { status: local ? "local" : "online" });
  } catch {
    return response(request, { status: "unreachable" });
  }
}

export function OPTIONS(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(origin)) return response(request, { code: "ORIGIN_NOT_ALLOWED" }, 403);
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "authorization,content-type");
  headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request) {
  if (!desktopStagingTargetIsVerified()) return response(request, { code: "DESKTOP_STAGING_TARGET_MISMATCH" }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response(request, { code: "SESSION_EXPIRED" }, 401);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBodyBytes) return response(request, { code: "REQUEST_TOO_LARGE" }, 413);
  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > maxBodyBytes) return response(request, { code: "REQUEST_TOO_LARGE" }, 413);
    body = JSON.parse(text);
  } catch { return response(request, { code: "INVALID_REQUEST" }, 400); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return response(request, { code: "INVALID_REQUEST", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400);
  const input = parsed.data;
  if (input.operations.some((operation) => operation.farmId !== input.farmId)) return response(request, { code: "FARM_SCOPE_MISMATCH" }, 400);

  const auth = createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await auth.auth.getUser(token);
  if (verified.error || !verified.data.user?.id) return response(request, { code: "SESSION_EXPIRED" }, 401);
  const userId = verified.data.user.id;
  const db = dbFor(token, input.farmId);
  const outcomes: Outcome[] = [];
  for (const operation of input.operations) {
    const result = await db.rpc("sync_desktop_operation_v1", { p_operation: operation });
    if (result.error) { outcomes.push(outcomeForError(operation, result.error)); continue; }
    const value = result.data as { code?: string; receipt?: unknown };
    outcomes.push({ operationId: operation.operationId, code: value.code ?? "RETRYABLE_FAILURE", receipt: value.receipt });
  }
  const accepted = outcomes.some((item) => item.code === "SUCCESS" || item.code === "ALREADY_SYNCED");
  if (!accepted) return response(request, { protocolVersion: 1, outcomes });
  try {
    const prepared = await canonicalRefresh(token, userId, input.farmId, input.installationId);
    return response(request, { protocolVersion: 1, outcomes, prepared });
  } catch {
    return response(request, { protocolVersion: 1, outcomes, refreshError: "CANONICAL_REFRESH_UNAVAILABLE" });
  }
}
