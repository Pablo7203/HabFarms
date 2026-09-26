"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/context";
import type { ActionResult } from "./auth";

export async function saveFeedingPlanAction(input: { flockId: string; feedTypeId: string; dailyFeedKg: number; effectiveFrom: string; notes?: string }): Promise<ActionResult> {
  await requireRole(["admin", "manager"]); const s = await createClient();
  if (!Number.isFinite(input.dailyFeedKg) || input.dailyFeedKg <= 0 || input.dailyFeedKg > 100000) return { ok: false, message: "Enter a daily feed amount greater than 0 and no more than 100,000 kg." };
  const { error } = await s.rpc("save_flock_daily_feeding_plan", { target_flock: input.flockId, target_feed_type: input.feedTypeId, target_daily_kg: input.dailyFeedKg, target_effective_from: input.effectiveFrom, target_notes: input.notes ?? null });
  if (error) return { ok: false, message: error.message }; revalidatePath("/feed/planning"); revalidatePath("/feed"); revalidatePath("/dashboard"); return { ok: true, message: "Daily flock feed target saved." };
}

export async function createHealthReminderAction(input: { flockId: string; activityType: string; title: string; dueDate: string; notes?: string }): Promise<ActionResult> {
  await requireRole(["admin", "manager"]); const s = await createClient();
  const { error } = await s.rpc("create_health_reminder", { target_flock: input.flockId, target_activity_type: input.activityType, target_title: input.title, target_due_date: input.dueDate, target_notes: input.notes ?? null });
  if (error) return { ok: false, message: error.message }; revalidatePath("/health/reminders"); revalidatePath("/dashboard"); return { ok: true, message: "Health reminder created." };
}

export async function completeHealthReminderAction(id: string, healthRecordId?: string): Promise<ActionResult> {
  await requireRole(["admin", "manager"]); const s = await createClient();
  const { error } = await s.rpc("complete_health_reminder", { target_reminder: id, target_health_record: healthRecordId ?? null });
  if (error) return { ok: false, message: error.message }; revalidatePath("/health/reminders"); revalidatePath("/dashboard"); return { ok: true, message: "Health reminder completed." };
}
