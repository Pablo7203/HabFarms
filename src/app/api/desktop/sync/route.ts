import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "@/lib/env";
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

function dbFor(token: string, farmId: string) {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, "x-habfarms-active-farm": farmId } },
  });
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

async function signPreparedSnapshot(snapshot: Record<string, unknown>, userId: string, farmId: string, installationId: string) {
  const privateKeyB64 = process.env.DESKTOP_LEASE_PRIVATE_KEY_B64;
  const privatePath = process.env.DESKTOP_LEASE_PRIVATE_KEY_PATH;
  if (!privateKeyB64 && !privatePath) throw new Error("DESKTOP_SNAPSHOT_SIGNER_UNAVAILABLE");
  const privateKey = createPrivateKey(privateKeyB64
    ? Buffer.from(privateKeyB64, "base64")
    : await readFile(path.resolve(privatePath!)));
  const actualPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  const publicPath = path.join(process.cwd(), "apps/desktop/src-tauri/src/lease-public-key.b64");
  const expectedPublic = (process.env.DESKTOP_LEASE_PUBLIC_KEY_B64 ?? await readFile(publicPath, "utf8")).trim();
  if (actualPublic !== expectedPublic) throw new Error("DESKTOP_SNAPSHOT_SIGNER_MISMATCH");
  const snapshotJson = JSON.stringify(snapshot);
  const issuedAt = new Date();
  const claimsJson = JSON.stringify({
    version: 1, keyId: process.env.DESKTOP_LEASE_KEY_ID ?? "development-2026-10", userId, farmId, installationId,
    issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 7 * 86400000).toISOString(),
    localSchemaMin: 2, localSchemaMax: 4,
    capabilities: ["snapshot_read", "queue_mortality_v1", "queue_daily_production_v1"],
    snapshotSha256: createHash("sha256").update(snapshotJson).digest("hex"),
  });
  const signatureB64 = sign(null, Buffer.from(claimsJson), privateKey).toString("base64");
  return { snapshotJson, claimsJson, signatureB64 };
}

async function canonicalRefresh(token: string, userId: string, farmId: string, installationId: string) {
  const db = dbFor(token, farmId);
  const [member, farm, settings, flocks, population, grades, feeds, recent, inventory] = await Promise.all([
    db.from("farm_members").select("role").eq("farm_id", farmId).eq("user_id", userId).eq("active", true).maybeSingle(),
    db.from("farms").select("id,name,timezone,currency,crate_size,active").eq("id", farmId).maybeSingle(),
    db.from("farm_settings").select("reporting_week_start").eq("farm_id", farmId).maybeSingle(),
    db.from("flocks").select("id,flock_name,batch_reference,breed,house_pen,start_date,status").eq("farm_id", farmId).order("flock_name"),
    db.from("v_current_flock_status").select("flock_id,current_live_birds").eq("farm_id", farmId),
    db.from("egg_grades").select("id,system_code,name,is_unsorted,sort_order").eq("farm_id", farmId).eq("is_active", true).order("sort_order"),
    db.from("feed_types").select("id,name").eq("farm_id", farmId).eq("active", true).order("name"),
    db.from("v_daily_production_metrics").select("production_id,flock_id,production_date,eggs_collected,cracked_eggs,good_eggs,live_birds,hen_day_percentage").eq("farm_id", farmId).order("production_date", { ascending: false }).limit(100),
    db.from("v_current_egg_inventory_by_grade").select("egg_grade_id,grade_name,total_eggs,is_unsorted,is_active").eq("farm_id", farmId).eq("is_active", true).order("grade_name"),
  ]);
  const queries = [member, farm, settings, flocks, population, grades, feeds, recent, inventory];
  const failed = queries.find((query) => query.error);
  if (failed?.error || !member.data || !farm.data?.active) throw new Error("CANONICAL_REFRESH_UNAVAILABLE");
  const lastProduction = new Map<string, string>();
  for (const row of recent.data ?? []) if (!lastProduction.has(row.flock_id)) lastProduction.set(row.flock_id, row.production_date);
  const birdCounts = new Map((population.data ?? []).map((row) => [row.flock_id, row.current_live_birds]));
  const snapshot = {
    snapshotVersion: 1, schemaVersion: 2, appVersion: "0.1.0", userId, farmId,
    synchronizedAt: new Date().toISOString(), role: member.data.role,
    farm: { id: farm.data.id, name: farm.data.name, timezone: farm.data.timezone, currency: farm.data.currency,
      crateSize: farm.data.crate_size, reportingWeekStart: settings.data?.reporting_week_start ?? 1 },
    flocks: (flocks.data ?? []).map((row) => ({ id: row.id, name: row.flock_name, batchReference: row.batch_reference,
      breed: row.breed, housePen: row.house_pen, startDate: row.start_date, status: row.status,
      currentLiveBirds: birdCounts.get(row.id) ?? null, lastProductionDate: lastProduction.get(row.id) ?? null })),
    eggGrades: (grades.data ?? []).map((row) => ({ id: row.id, code: row.system_code, name: row.name, isUnsorted: row.is_unsorted, sortOrder: row.sort_order })),
    feedTypes: (feeds.data ?? []).map((row) => ({ id: row.id, name: row.name })),
    recentProduction: (recent.data ?? []).map((row) => ({ productionRecordId: row.production_id, flockId: row.flock_id, eventDate: row.production_date,
      eggsCollected: row.eggs_collected, crackedEggs: row.cracked_eggs, goodEggs: row.good_eggs, eligibleBirds: row.live_birds,
      productionPercentage: row.hen_day_percentage })),
    eggInventory: (inventory.data ?? []).map((row) => ({ gradeId: row.egg_grade_id, gradeName: row.grade_name, eggs: Number(row.total_eggs), isUnsorted: row.is_unsorted })),
  };
  return signPreparedSnapshot(snapshot, userId, farmId, installationId);
}

export async function GET(request: Request) {
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
