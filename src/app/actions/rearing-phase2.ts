"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAppContext, requireRole } from "@/lib/auth/context";
import type { ActionResult } from "@/app/actions/auth";
import {
  rearingCostExpenseSchema, rearingFeedConsumptionSchema, rearingFeedCorrectionSchema,
  rearingFeedPlanSchema, rearingHealthReminderSchema, rearingHealthSchema,
} from "@/lib/validation/rearing-phase2";

const fail = (message: string): ActionResult => {
  const lower = message.toLowerCase();
  if (lower.includes("available") || lower.includes("feed") && lower.includes("only")) return { ok: false, message: "There is not enough of this feed in the farm's available stock." };
  if (lower.includes("access denied") || lower.includes("permission")) return { ok: false, message: "You do not have permission to make this change." };
  if (lower.includes("already exists")) return { ok: false, message: "An active acquisition cost is already linked to this batch." };
  console.error("Rearing Phase 2 operation failed", message);
  return { ok: false, message: "We couldn't save this rearing entry. Check the values and try again." };
};
const refreshBatch = (id: string) => {
  revalidatePath(`/rearing/${id}`); revalidatePath(`/rearing/${id}/daily`); revalidatePath("/rearing");
  revalidatePath("/feed"); revalidatePath("/feed/planning"); revalidatePath("/health"); revalidatePath("/health/reminders");
  revalidatePath("/expenses"); revalidatePath("/payables"); revalidatePath("/cash-flow");
};

export async function recordRearingFeedAction(batchId: string, input: unknown): Promise<ActionResult> {
  const c = await requireAppContext(), p = rearingFeedConsumptionSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data, s = await createClient();
  const { error } = await s.rpc("record_rearing_feed_consumption", {
    target_batch: batchId, target_feed_type: d.feedTypeId, target_date: d.consumptionDate,
    target_quantity_kg: d.quantityKg, target_daily_record: d.dailyRecordId || null,
    target_notes: d.notes,
  });
  if (error) return fail(error.message);
  refreshBatch(batchId);
  return { ok: true, message: `Feed use recorded for ${c.farm.name}.` };
}

export async function correctRearingFeedAction(batchId: string, consumptionId: string, input: unknown): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const p = rearingFeedCorrectionSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data, s = await createClient();
  const { error } = await s.rpc("correct_rearing_feed_consumption", {
    target_consumption: consumptionId, target_feed_type: d.feedTypeId, target_date: d.consumptionDate,
    target_quantity_kg: d.quantityKg, target_reason: d.reason, target_notes: d.notes,
  });
  if (error) return fail(error.message);
  refreshBatch(batchId);
  return { ok: true, message: "Feed entry corrected. The original stock movement was preserved and reversed." };
}

export async function saveRearingFeedPlanAction(batchId: string, input: unknown): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const p = rearingFeedPlanSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data, s = await createClient();
  const { error } = await s.rpc("save_rearing_feed_plan", {
    target_batch: batchId, target_feed_type: d.feedTypeId, target_stage: d.feedingStage,
    target_grams: d.gramsPerBirdPerDay, target_effective_from: d.effectiveFrom, target_notes: d.notes,
  });
  if (error) return fail(error.message);
  refreshBatch(batchId);
  return { ok: true, message: "Effective-dated rearing feed target saved." };
}

export async function createRearingHealthAction(batchId: string, input: unknown): Promise<ActionResult & { id?: string }> {
  const c = await requireAppContext(), p = rearingHealthSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data;
  if (c.membership.role === "worker" && (d.cost > 0 || d.initialPayment > 0)) return { ok: false, message: "Workers cannot enter health costs or payments." };
  const s = await createClient(), { data, error } = await s.rpc("create_rearing_health_record", {
    target_batch: batchId, record_date: d.recordDate, health_type: d.healthType, product_name: d.productName,
    reason: d.reason, dose: d.dose, route: d.route, duration: d.duration,
    quantity: d.quantity === "" ? null : d.quantity, quantity_unit: d.quantityUnit,
    veterinary_provider: d.veterinaryProvider, cost: c.membership.role === "worker" ? 0 : d.cost,
    next_due_date: d.nextDueDate || null, notes: d.notes, initial_payment: c.membership.role === "worker" ? 0 : d.initialPayment,
    payment_method: d.paymentMethod, reference: d.reference,
  });
  if (error) return fail(error.message);
  refreshBatch(batchId);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, message: "Health activity recorded against this rearing batch.", id: row?.id };
}

export async function createRearingHealthReminderAction(batchId: string, input: unknown): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const p = rearingHealthReminderSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data, s = await createClient();
  const { error } = await s.rpc("create_rearing_health_reminder", {
    target_batch: batchId, target_activity_type: d.activityType, target_title: d.title,
    target_due_date: d.dueDate, target_notes: d.notes,
  });
  if (error) return fail(error.message);
  refreshBatch(batchId);
  return { ok: true, message: "Health activity scheduled; it remains separate from administration." };
}

export async function createRearingCostExpenseAction(batchId: string, input: unknown): Promise<ActionResult & { id?: string }> {
  await requireRole(["admin", "manager"]);
  const p = rearingCostExpenseSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const d = p.data, s = await createClient(), { data, error } = await s.rpc("create_rearing_cost_expense", {
    target_batch: batchId, target_cost_kind: d.costKind, target_date: d.expenseDate, target_category: d.categoryId,
    target_description: d.description, target_supplier: d.supplierId || null, target_payee: d.payeeName || null,
    target_amount: d.amount, target_initial_payment: d.initialPayment, target_payment_method: d.paymentMethod,
    target_reference: d.reference || null, target_notes: d.notes,
  });
  if (error) return fail(error.message);
  refreshBatch(batchId);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, message: "Batch cost recorded in the existing expense and payment ledgers.", id: row?.id };
}
