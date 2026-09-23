"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/context";
import type { ActionResult } from "@/app/actions/auth";
import { rearingTransferSchema } from "@/lib/validation/rearing-phase2";

export type RearingTransferPreview = {
  ok: boolean;
  message?: string;
  availableBirds: number;
  remainingCost: number;
  costComplete: boolean;
};

export async function getRearingTransferPreviewAction(batchId: string, transferDate: string): Promise<RearingTransferPreview> {
  const context = await requireRole(["admin", "manager"]);
  const supabase = await createClient();
  const { data: batch } = await supabase.from("rearing_batches").select("id").eq("id", batchId).eq("farm_id", context.farm.id).maybeSingle();
  if (!batch) return { ok: false, message: "Rearing batch not found.", availableBirds: 0, remainingCost: 0, costComplete: false };
  const { data, error } = await supabase.rpc("get_rearing_transfer_preview", { target_batch: batchId, target_date: transferDate });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return { ok: false, message: "Could not refresh this date’s population and cost. Check the date and try again.", availableBirds: 0, remainingCost: 0, costComplete: false };
  return { ok: true, availableBirds: Number(row.available_birds), remainingCost: Number(row.remaining_cost), costComplete: Boolean(row.cost_complete) };
}

export async function postRearingTransferAction(batchId: string, input: unknown): Promise<ActionResult> {
  const context = await requireRole(["admin", "manager"]);
  const parsed = rearingTransferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the transfer details." };
  const d = parsed.data;
  const supabase = await createClient();
  const { data: batch } = await supabase.from("rearing_batches").select("id").eq("id", batchId).eq("farm_id", context.farm.id).maybeSingle();
  if (!batch) return { ok: false, message: "Rearing batch not found in the selected farm." };
  const newFlock = d.newFlockName ? {
    flock_name: d.newFlockName,
    batch_reference: d.newFlockBatchReference,
    breed: d.newFlockBreed,
    house_pen: d.newFlockHousePen,
    age_at_arrival_weeks: d.newFlockAgeWeeks === "" ? null : d.newFlockAgeWeeks,
    start_date: d.transferDate,
  } : null;
  const { data, error } = await supabase.rpc("post_rearing_transfer", {
    target_batch: batchId,
    target_date: d.transferDate,
    target_quantity: d.quantity,
    target_destination_flock: d.destinationFlockId || null,
    target_new_flock: newFlock,
    target_notes: d.notes,
    target_cost_review_confirmed: d.costReviewed,
    target_idempotency_key: d.idempotencyKey,
  });
  if (error || !data) {
    const message = error?.message.toLowerCase() ?? "";
    if (message.includes("population") || message.includes("available") || message.includes("quantity")) return { ok: false, message: "The batch population changed or the quantity is no longer available. Review the updated transfer details." };
    if (message.includes("cost") || message.includes("historical")) return { ok: false, message: error?.message ?? "Reconcile the batch cost history before transferring." };
    if (message.includes("access denied") || message.includes("permission")) return { ok: false, message: "You do not have permission to transfer birds from this batch." };
    return { ok: false, message: error?.message ?? "The transfer could not be posted. No changes were committed." };
  }
  const transfer = Array.isArray(data) ? data[0] : data;
  const destinationId = transfer.destination_flock_id as string;
  revalidatePath(`/rearing/${batchId}`);
  revalidatePath(`/rearing/${batchId}/transfer`);
  revalidatePath(`/rearing/transfers/${transfer.id}`);
  revalidatePath(`/flocks/${destinationId}`);
  revalidatePath("/rearing");
  revalidatePath("/flocks");
  revalidatePath("/dashboard");
  revalidatePath("/feed/planning");
  return { ok: true, message: "Transfer completed successfully.", id: transfer.id, nextPath: `/rearing/transfers/${transfer.id}` };
}

export async function reverseRearingTransferAction(transferId: string, reason: string): Promise<ActionResult> {
  const context = await requireRole(["admin"]);
  if (reason.trim().length < 3 || reason.trim().length > 500) return { ok: false, message: "Give a reversal reason of at least 3 characters." };
  const supabase = await createClient();
  const { data: details, error: detailsError } = await supabase.rpc("get_rearing_transfer_detail", { target_transfer: transferId });
  const row = Array.isArray(details) ? details[0] : details;
  if (detailsError || !row || row.farm_id !== context.farm.id) return { ok: false, message: "Transfer not found in the selected farm." };
  const { error } = await supabase.rpc("reverse_rearing_transfer", { target_transfer: transferId, target_reason: reason.trim() });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/rearing/${row.source_batch_id}`);
  revalidatePath(`/rearing/transfers/${transferId}`);
  revalidatePath(`/flocks/${row.destination_flock_id}`);
  revalidatePath("/rearing");
  revalidatePath("/flocks");
  return { ok: true, message: "Transfer reversed. Both population ledgers and the cost pool were restored." };
}
