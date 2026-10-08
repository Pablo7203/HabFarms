"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAppContext, requireRole } from "@/lib/auth/context";
import { rearingBatchSchema, rearingBatchUpdateSchema, rearingDailySchema } from "@/lib/validation/rearing";
import type { ActionResult } from "@/app/actions/auth";

function errorMessage(message: string) {
  if (message.includes("A daily record already exists for this batch and date")) return "A daily record already exists for this batch on that date. Choose another date.";
  if (message.includes("already exists")) return "That batch code or daily record already exists.";
  if (message.includes("population negative") || message.includes("nonnegative")) return "This correction would make the batch's bird balance negative on a later date. Review later records or transfers before saving.";
  if (message.includes("available")) return "Deaths cannot exceed the birds available on the selected date. No changes were saved.";
  if (message.includes("Invalid rearing daily record date or values")) return "Choose a date from the batch arrival date through today, and enter a non-negative whole number of deaths.";
  if (message.includes("mortality ledger integrity")) return "This record's mortality history needs support review before it can be corrected. No changes were saved.";
  if (message.includes("Workers may record today only")) return "Workers can only submit today's daily rearing record.";
  if (message.includes("Only farm admins or managers")) return "Only farm admins or managers can correct a saved daily record.";
  if (message.includes("Invalid rearing batch") || message.includes("hatch")) return "Check the batch details and dates, then try again.";
  if (message.includes("supplier")) return "Choose an active supplier from this farm.";
  if (message.includes("permission") || message.includes("access denied")) return "You do not have permission to make this change.";
  console.error("Rearing operation failed", message);
  return "We couldn't save this rearing record. Please try again.";
}

export async function createRearingBatchAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const context = await requireRole(["admin", "manager"]), parsed = rearingBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data, supabase = await createClient();
  const { data, error } = await supabase.rpc("create_rearing_batch", { target_farm: context.farm.id, target_batch_code: d.batchCode, target_breed: d.breed, target_supplier: d.supplierId || null, target_arrival_date: d.arrivalDate, target_hatch_date: d.hatchDate || null, target_initial_quantity: d.initialQuantity, target_notes: d.notes });
  if (error) return { ok: false, message: errorMessage(error.message) };
  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath("/rearing");
  return { ok: true, message: "Rearing batch created.", id: row.id };
}

export async function updateRearingBatchAction(batchId: string, input: unknown): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const parsed = rearingBatchUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("update_rearing_batch", { target_batch: batchId, target_breed: d.breed, target_supplier: d.supplierId || null, target_arrival_date: d.arrivalDate, target_hatch_date: d.hatchDate || null, target_notes: d.notes });
  if (error) return { ok: false, message: errorMessage(error.message) };
  revalidatePath(`/rearing/${batchId}`); revalidatePath("/rearing");
  return { ok: true, message: "Batch details updated." };
}

export async function changeRearingStageAction(batchId: string, formData: FormData) {
  await requireRole(["admin", "manager"]);
  const stage = String(formData.get("stage") ?? ""), supabase = await createClient();
  const { error } = await supabase.rpc("change_rearing_batch_stage", { target_batch: batchId, new_stage: stage });
  if (error) throw new Error(errorMessage(error.message));
  revalidatePath(`/rearing/${batchId}`); revalidatePath("/rearing");
}

export async function saveRearingDailyRecordAction(batchId: string, recordId: string | null, input: unknown): Promise<ActionResult> {
  const context = await requireAppContext();
  if (recordId && !["admin", "manager"].includes(context.membership.role)) return { ok: false, message: "Only a farm admin or manager can correct a posted record." };
  const parsed = rearingDailySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("save_rearing_daily_record", { target_batch: batchId, target_record_date: d.recordDate, target_deaths: d.deaths, target_observations: d.observations, target_record: recordId });
  if (error) return { ok: false, message: errorMessage(error.message) };
  revalidatePath(`/rearing/${batchId}`); revalidatePath(`/rearing/${batchId}/daily`); revalidatePath("/rearing");
  return { ok: true, message: recordId ? "Daily record corrected. Mortality changes were recorded in the audit ledger." : "Daily record saved." };
}
