import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { desktopIdentity, desktopOptions, desktopResponse, desktopStagingTargetIsVerified } from "@/lib/desktop/http";
import { dbFor } from "@/lib/desktop/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = desktopOptions;

export async function GET(request: Request) {
  if (!desktopStagingTargetIsVerified()) return desktopResponse(request, { code: "DESKTOP_STAGING_TARGET_MISMATCH" }, 503);
  const identity = await desktopIdentity(request);
  if (!identity) return desktopResponse(request, { code: "SESSION_EXPIRED" }, 401);
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${identity.token}` } },
  });
  const memberships = await db.from("farm_members").select("farm_id,role").eq("user_id", identity.userId).eq("active", true);
  if (memberships.error) return desktopResponse(request, { code: "FARM_LIST_UNAVAILABLE" }, 503);
  if (!memberships.data?.length) return desktopResponse(request, { userId: identity.userId, email: identity.email, farms: [] });
  const farms = await db.from("farms").select("id,name,timezone").in("id", memberships.data.map((member) => member.farm_id)).eq("active", true);
  if (farms.error) return desktopResponse(request, { code: "FARM_LIST_UNAVAILABLE" }, 503);
  const choices = [];
  for (const farm of farms.data ?? []) {
    const access = await dbFor(identity.token, farm.id).rpc("get_farm_access_mode", { target_farm_id: farm.id });
    if (access.error) return desktopResponse(request, { code: "FARM_LIST_UNAVAILABLE" }, 503);
    if (access.data === "full") choices.push({
      id: farm.id, name: farm.name, timezone: farm.timezone,
      role: memberships.data.find((member) => member.farm_id === farm.id)?.role,
    });
  }
  return desktopResponse(request, { userId: identity.userId, email: identity.email, farms: choices });
}
