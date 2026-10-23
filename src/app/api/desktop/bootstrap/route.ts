import { z } from "zod";
import { desktopIdentity, desktopOptions, desktopResponse } from "@/lib/desktop/http";
import { canonicalRefresh } from "@/lib/desktop/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = desktopOptions;

const requestSchema = z.strictObject({ farmId: z.uuid(), installationId: z.uuid() });

export async function POST(request: Request) {
  const identity = await desktopIdentity(request);
  if (!identity) return desktopResponse(request, { code: "SESSION_EXPIRED" }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return desktopResponse(request, { code: "REQUEST_TOO_LARGE" }, 413);
  let parsed;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 4096) return desktopResponse(request, { code: "REQUEST_TOO_LARGE" }, 413);
    parsed = requestSchema.safeParse(JSON.parse(text));
  } catch { return desktopResponse(request, { code: "INVALID_REQUEST" }, 400); }
  if (!parsed.success) return desktopResponse(request, { code: "INVALID_REQUEST" }, 400);
  try {
    const prepared = await canonicalRefresh(identity.token, identity.userId, parsed.data.farmId, parsed.data.installationId);
    return desktopResponse(request, { snapshot: JSON.parse(prepared.snapshotJson), lease: { claims: prepared.claimsJson, signature: prepared.signatureB64 } });
  } catch (error) {
    if (error instanceof Error && error.message === "FARM_ACCESS_DENIED") return desktopResponse(request, { code: "FARM_ACCESS_DENIED" }, 403);
    return desktopResponse(request, { code: "BOOTSTRAP_UNAVAILABLE" }, 503);
  }
}
