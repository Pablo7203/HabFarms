"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/context";
import { farmNameSchema, farmSettingsSchema } from "@/lib/validation/farm";
import { userMessage } from "@/lib/utils";
import type { ActionResult } from "./auth";

export async function createFarmAction(input: unknown): Promise<ActionResult> {
  const parsed = farmNameSchema.safeParse(input); if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient(); const { error } = await supabase.rpc("create_farm_with_admin", { farm_name: parsed.data });
  if (error) return { ok: false, message: userMessage(error) }; redirect("/dashboard");
}
export async function updateFarmSettingsAction(input: unknown): Promise<ActionResult> {
  const context = await requireRole(["admin"]); const parsed = farmSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data; const supabase = await createClient();
  const { error } = await supabase.rpc("update_farm_configuration", { target_farm_id: context.farm.id, farm_name: d.name, farm_currency: d.currency, farm_timezone: d.timezone, farm_crate_size: d.crateSize, farm_feed_bag_size_kg: d.feedBagSizeKg, farm_opening_cash_balance: d.openingCashBalance, egg_price_per_crate: d.defaultEggPricePerCrate, loose_egg_price: d.defaultLooseEggPrice, warning_days: d.feedAlertWarningDays, critical_days: d.feedAlertCriticalDays, average_days: d.averageFeedDaysWindow });
  if (error) return { ok: false, message: userMessage(error) }; revalidatePath("/settings"); return { ok: true, message: "Farm settings saved." };
}
