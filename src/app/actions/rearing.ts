"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAppContext, requireRole } from "@/lib/auth/context";
import { rearingBatchSchema, rearingBatchUpdateSchema, rearingDailySchema } from "@/lib/validation/rearing";
import type { ActionResult } from "@/app/actions/auth";

function errorMessage(message: string) {
  if (message.includes("already exists")) return "That batch code or daily record already exists.";
  if (message.includes("available") || message.includes("negative")) return "Deaths cannot exceed the birds available on that date.";
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
  return { ok: true, message: recordId ? "Daily record corrected with an audited mortality reversal." : "Daily record saved." };
}
