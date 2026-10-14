"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAppContext, requireRole } from "@/lib/auth/context";
import { broilerDispatchSchema, rearingBatchSchema, rearingBatchUpdateSchema, rearingDailySchema, rearingWeightSampleSchema } from "@/lib/validation/rearing";
import type { ActionResult } from "@/app/actions/auth";

function errorMessage(message: string) {
  if (message.includes("sample size exceeds")) return "The sample includes more birds than were available in this batch on that date.";
  if (message.includes("dispatches in date order")) return "Record broiler dispatches in date order. Correct later entries before backdating this one.";
  if (message.includes("only an active broiler batch")) return "This action is only available for an active broiler batch marked Ready for market.";
  if (message.includes("brooder temperature is only")) return "Brooder temperature can only be recorded for broiler batches.";
  if (message.includes("already exists")) return "That batch code or daily record already exists.";
  if (message.includes("dispatch quantity")) return "The number being sold or dispatched exceeds the birds available on that date.";
  if (message.includes("ready for market")) return "Mark this broiler batch Ready for market before recording a sale or dispatch.";
  if (message.includes("later population movement")) return "A later bird movement exists. Review the batch history before reversing this dispatch.";
  if (message.includes("available") || message.includes("negative")) return "The quantity entered exceeds birds available on that date. Check the batch movement history and try again.";
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
  const { data, error } = await supabase.rpc("create_rearing_batch_for_purpose", { target_farm: context.farm.id, target_batch_code: d.batchCode, target_breed: d.breed, target_supplier: d.supplierId || null, target_arrival_date: d.arrivalDate, target_hatch_date: d.hatchDate || null, target_initial_quantity: d.initialQuantity, target_notes: d.notes, target_bird_purpose: d.birdPurpose });
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
  const { error } = await supabase.rpc("save_rearing_daily_record_v2", { target_batch: batchId, target_record_date: d.recordDate, target_deaths: d.deaths, target_observations: d.observations, target_record: recordId, target_feed_check: d.feedCheck || null, target_water_check: d.waterCheck || null, target_brooder_temperature_c: d.brooderTemperatureC === "" ? null : d.brooderTemperatureC });
  if (error) return { ok: false, message: errorMessage(error.message) };
  revalidatePath(`/rearing/${batchId}`); revalidatePath(`/rearing/${batchId}/daily`); revalidatePath("/rearing");
  return { ok: true, message: recordId ? "Daily record corrected with an audited mortality reversal." : "Daily record saved." };
}

export async function recordRearingWeightSampleAction(batchId: string, input: unknown): Promise<ActionResult> {
  const context = await requireAppContext();
  const parsed = rearingWeightSampleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("record_rearing_weight_sample", {
    target_batch: batchId, target_date: d.sampleDate, target_sample_size: d.sampleSize,
    target_average_weight_kg: d.averageWeightKg,
    target_uniformity_percentage: d.uniformityPercentage === "" ? null : d.uniformityPercentage,
    target_notes: d.notes,
  });
  if (error) return { ok: false, message: errorMessage(error.message) };
  revalidatePath(`/rearing/${batchId}`); revalidatePath("/rearing");
  return { ok: true, message: `Growth sample saved for ${context.farm.name}.` };
}

export async function postBroilerDispatchAction(batchId: string, input: unknown): Promise<ActionResult & { id?: string }> {
  await requireRole(["admin", "manager"]);
  const parsed = broilerDispatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data, supabase = await createClient();
  const { data, error } = await supabase.rpc("post_rearing_broiler_dispatch", {
    target_batch: batchId, target_date: d.dispatchDate, target_quantity: d.quantity,
    target_buyer: d.buyerName, target_total_amount: d.totalAmount, target_notes: d.notes,
  });
  if (error) return { ok: false, message: errorMessage(error.message) };
  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath(`/rearing/${batchId}`); revalidatePath("/rearing"); revalidatePath("/dashboard");
  return { ok: true, message: "Broiler sale/dispatch recorded and removed from the batch population.", id: row.id };
}

export async function reverseBroilerDispatchAction(dispatchId: string, batchId: string, reason: string): Promise<ActionResult> {
  await requireRole(["admin"]);
  if (reason.trim().length < 3 || reason.trim().length > 500) return { ok: false, message: "Give a reversal reason of at least 3 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_rearing_broiler_dispatch", { target_dispatch: dispatchId, target_reason: reason.trim() });
  if (error) return { ok: false, message: errorMessage(error.message) };
  revalidatePath(`/rearing/${batchId}`); revalidatePath("/rearing"); revalidatePath("/dashboard");
  return { ok: true, message: "Broiler dispatch reversed with a linked population-ledger movement." };
}
