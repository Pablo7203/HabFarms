"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAppContext, requireRole } from "@/lib/auth/context";
import { broilerDispatchSchema, rearingBatchSchema, rearingBatchUpdateSchema, rearingDailySchema, rearingWeightSampleSchema } from "@/lib/validation/rearing";
import type { ActionResult } from "@/app/actions/auth";

function errorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("a daily record already exists for this batch and date")) return "A daily record already exists for this batch on that date. Choose another date.";
  if (normalized.includes("population negative") || normalized.includes("nonnegative")) return "This correction would make the batch's bird balance negative on a later date. Review later records or transfers before saving.";
  if (normalized.includes("invalid rearing daily record date or values")) return "Choose a date from the batch arrival date through today, and enter a non-negative whole number of deaths.";
  if (normalized.includes("mortality ledger integrity")) return "This record's mortality history needs support review before it can be corrected. No changes were saved.";
  if (normalized.includes("workers may record today only")) return "Workers can only submit today's daily rearing record.";
  if (normalized.includes("only farm admins or managers")) return "Only farm admins or managers can correct a saved daily record.";
  if (normalized.includes("sample size exceeds")) return "The sample includes more birds than were available in this batch on that date. Enter a smaller sample size.";
  if (normalized.includes("check the sample date, sample size, average weight, and uniformity")) return "Check that the sample date is after arrival and not in the future, the sample size is within the birds available, the average weight is between 0 and 50 kg, and uniformity is between 0 and 100%.";
  if (normalized.includes("dispatches in date order")) return "Record broiler dispatches in date order. Correct later entries before backdating this one.";
  if (normalized.includes("only an active broiler batch")) return "This action is only available for an active broiler batch marked Ready for market.";
  if (normalized.includes("brooder temperature is only")) return "Brooder temperature can only be recorded for broiler batches.";
  if (normalized.includes("already exists")) return "That batch code or daily record already exists.";
  if (normalized.includes("dispatch quantity")) return "The number being sold or dispatched exceeds the birds available on that date.";
  if (normalized.includes("ready for market")) return "Mark this broiler batch Ready for market before recording a sale or dispatch.";
  if (normalized.includes("later population movement")) return "A later bird movement exists. Review the batch history before reversing this dispatch.";
  if (normalized.includes("available") || normalized.includes("negative")) return "The quantity entered exceeds birds available on that date. Check the batch movement history and try again.";
  if (normalized.includes("invalid rearing batch") || normalized.includes("hatch")) return "Check the batch details and dates, then try again.";
  if (normalized.includes("supplier")) return "Choose an active supplier from this farm.";
  if (normalized.includes("permission") || normalized.includes("access denied")) return "You do not have permission to make this change.";
  console.error("Rearing operation failed", { message });
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

export async function changeRearingStageAction(batchId: string, formData: FormData): Promise<ActionResult> {
  await requireRole(["admin", "manager"]);
  const stage = String(formData.get("stage") ?? ""), supabase = await createClient();
  if (!["brooding", "growing", "finishing", "ready_for_transfer", "ready_for_market"].includes(stage)) return { ok: false, message: "Choose a valid lifecycle stage and try again." };
  const { error } = await supabase.rpc("change_rearing_batch_stage", { target_batch: batchId, new_stage: stage });
  if (error) return { ok: false, message: errorMessage(error.message) };
  revalidatePath(`/rearing/${batchId}`); revalidatePath("/rearing");
  return { ok: true, message: "Lifecycle stage updated." };
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
