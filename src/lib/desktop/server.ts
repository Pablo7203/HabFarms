import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function dbFor(token: string, farmId: string) {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, "x-habfarms-active-farm": farmId } },
  });
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

export async function canonicalRefresh(token: string, userId: string, farmId: string, installationId: string) {
  const db = dbFor(token, farmId);
  const [access, member, farm, settings, flocks, population, grades, feeds, recent, inventory] = await Promise.all([
    db.rpc("get_farm_access_mode", { target_farm_id: farmId }),
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
  const queries = [access, member, farm, settings, flocks, population, grades, feeds, recent, inventory];
  const failed = queries.find((query) => query.error);
  if (failed?.error) throw new Error("CANONICAL_REFRESH_UNAVAILABLE");
  if (access.data !== "full" || !member.data || !farm.data?.active) throw new Error("FARM_ACCESS_DENIED");
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
