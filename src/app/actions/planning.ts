"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/context";
import { actionErrorMessage, validationMessage } from "@/lib/utils";
import { completeHealthReminderSchema, feedingPlanSchema, healthReminderSchema } from "@/lib/validation/planning";
import type { ActionResult } from "./auth";

export async function saveFeedingPlanAction(input: unknown): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const parsed = feedingPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: validationMessage(parsed.error) };
  const d = parsed.data, s = await createClient();
  const { error } = await s.rpc("save_flock_daily_feeding_plan", { target_flock: d.flockId, target_feed_type: d.feedTypeId, target_daily_kg: d.dailyFeedKg, target_effective_from: d.effectiveFrom, target_notes: d.notes || null });
  if (error) return { ok: false, message: actionErrorMessage(error, "The feeding plan couldn't be saved. Check the flock, feed type, and date, then try again.") };
  revalidatePath("/feed/planning"); revalidatePath("/feed"); revalidatePath("/dashboard");
  return { ok: true, message: "Daily flock feed target saved." };
}

export async function createHealthReminderAction(input: unknown): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const parsed = healthReminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: validationMessage(parsed.error) };
  const d = parsed.data, s = await createClient();
  const { error } = await s.rpc("create_health_reminder", { target_flock: d.flockId, target_activity_type: d.activityType, target_title: d.title, target_due_date: d.dueDate, target_notes: d.notes || null });
  if (error) return { ok: false, message: actionErrorMessage(error, "The health reminder couldn't be created. Check the flock, activity, and due date, then try again.") };
  revalidatePath("/health/reminders"); revalidatePath("/dashboard");
  return { ok: true, message: "Health reminder created." };
}

export async function completeHealthReminderAction(id: string, healthRecordId?: string): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const parsed = completeHealthReminderSchema.safeParse({ reminderId: id, healthRecordId });
  if (!parsed.success) return { ok: false, message: validationMessage(parsed.error) };
  const d = parsed.data, s = await createClient();
  const { error } = await s.rpc("complete_health_reminder", { target_reminder: d.reminderId, target_health_record: d.healthRecordId ?? null });
  if (error) return { ok: false, message: actionErrorMessage(error, "The reminder couldn't be marked complete. Refresh the page and try again.") };
  revalidatePath("/health/reminders"); revalidatePath("/dashboard");
  return { ok: true, message: "Health reminder completed." };
}
