"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/context";
import type { ActionResult } from "@/app/actions/auth";

const planInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  monthlyPrice: z.coerce.number().min(0),
  annualPrice: z.coerce.number().min(0),
  trialDays: z.coerce.number().int().min(0).max(365),
  graceDays: z.coerce.number().int().min(0).max(365),
  maxUsers: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean(),
});

function failure(message: string) { return { ok: false, message }; }
function refreshPlans() { revalidatePath("/platform"); revalidatePath("/platform/plans"); revalidatePath("/platform/farms"); }

export async function createSubscriptionPlanAction(input: unknown): Promise<ActionResult> {
  const parsed = planInput.extend({ code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/) }).safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);
  await requirePlatformAdmin();
  const value = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("platform_create_subscription_plan", {
    target_code: value.code,
    target_name: value.name,
    target_description: value.description ?? "",
    target_currency: value.currency,
    target_monthly_price: value.monthlyPrice,
    target_annual_price: value.annualPrice,
    target_trial_days: value.trialDays,
    target_grace_days: value.graceDays,
    target_max_users: value.maxUsers ?? null,
  });
  if (error) return failure(error.message.includes("duplicate") ? "That plan code is already in use." : "We could not create the subscription plan.");
  refreshPlans();
  return { ok: true, message: "Subscription plan created." };
}

export async function updateSubscriptionPlanAction(input: unknown): Promise<ActionResult> {
  const parsed = planInput.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);
  await requirePlatformAdmin();
  const value = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("platform_update_subscription_plan", {
    target_plan: value.id,
    target_name: value.name,
    target_description: value.description ?? "",
    target_currency: value.currency,
    target_monthly_price: value.monthlyPrice,
    target_annual_price: value.annualPrice,
    target_trial_days: value.trialDays,
    target_grace_days: value.graceDays,
    target_max_users: value.maxUsers ?? null,
    target_active: value.isActive,
  });
  if (error) return failure("We could not update the subscription plan.");
  refreshPlans();
  return { ok: true, message: value.isActive ? "Subscription plan updated." : "Subscription plan deactivated. Historical subscriptions remain intact." };
}

const paymentInput = z.object({ periodId: z.string().uuid(), amount: z.coerce.number().positive(), method: z.enum(["momo", "bank_transfer", "cash", "paystack_manual", "other"]), reference: z.string().trim().max(160).optional(), paidAt: z.string().date(), notes: z.string().trim().max(1000).optional(), idempotencyKey: z.string().uuid() });

export async function recordSubscriptionPaymentAction(input: unknown): Promise<ActionResult> {
  const parsed = paymentInput.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);
  await requirePlatformAdmin();
  const value = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("platform_record_subscription_payment", {
    target_period: value.periodId,
    target_amount: value.amount,
    target_payment_method: value.method,
    target_reference: value.reference ?? "",
    target_paid_at: value.paidAt,
    target_notes: value.notes ?? "",
    target_idempotency_key: value.idempotencyKey,
  });
  if (error) return failure(error.message.includes("exceeds") ? "Payment exceeds the outstanding balance." : "We could not record this subscription payment.");
  revalidatePath("/platform"); revalidatePath("/platform/subscriptions"); revalidatePath("/platform/payments");
  return { ok: true, message: "Subscription payment recorded." };
}

const subscriptionIdInput = z.object({ subscriptionId: z.string().uuid() });

const manualInvoiceInput = z.object({
  farmId: z.string().uuid(),
  description: z.string().trim().min(3).max(500),
  amount: z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/, "Enter an amount with no more than two decimal places.").transform(Number).refine((value) => value > 0, "The amount must be greater than zero."),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  invoiceDate: z.string().date(),
  dueDate: z.string().date(),
}).refine((value) => value.dueDate >= value.invoiceDate, { message: "The due date cannot be before the invoice date." });

export async function createManualInvoiceAction(input: unknown): Promise<ActionResult & { invoiceId?: string }> {
  const parsed = manualInvoiceInput.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0].message);
  await requirePlatformAdmin();
  const value = parsed.data, supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_create_manual_invoice", {
    target_farm: value.farmId,
    target_description: value.description,
    target_amount: value.amount,
    target_currency: value.currency,
    target_invoice_date: value.invoiceDate,
    target_due_date: value.dueDate,
  });
  if (error || typeof data !== "string") return { ...failure("We could not issue this invoice. Check the details and try again."), invoiceId: undefined };
  revalidatePath("/platform/invoices");
  revalidatePath(`/platform/farms/${value.farmId}`);
  return { ok: true, message: "Manual invoice issued.", invoiceId: data };
}

const manualInvoiceVoidInput = z.object({ invoiceId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });
export async function voidManualInvoiceAction(input: unknown): Promise<ActionResult> {
  const parsed = manualInvoiceVoidInput.safeParse(input);
  if (!parsed.success) return failure("Provide a void reason of at least three characters.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_void_manual_invoice", { target_invoice: parsed.data.invoiceId, target_reason: parsed.data.reason });
  if (error) return failure("We could not void this invoice. It may already be void.");
  revalidatePath("/platform/invoices");
  revalidatePath(`/platform/invoices/manual/${parsed.data.invoiceId}`);
  return { ok: true, message: "Invoice voided and retained in the audit history." };
}

export async function prepareSubscriptionBillingPeriodAction(input: unknown): Promise<ActionResult> {
  const parsed = subscriptionIdInput.safeParse(input);
  if (!parsed.success) return failure("A valid subscription is required.");
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_prepare_subscription_billing_period", { target_subscription: parsed.data.subscriptionId });
  if (error) return failure(error.message.includes("price") ? "Set a monthly or annual price on this plan before creating a billing period." : "We could not prepare a billing period.");
  revalidatePath("/platform"); revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`);
  return { ok: true, message: "Billing period prepared. You can now record the payment." };
}

const voidInput = z.object({ paymentId: z.string().uuid(), subscriptionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

export async function voidSubscriptionPaymentAction(input: unknown): Promise<ActionResult> {
  const parsed = voidInput.safeParse(input);
  if (!parsed.success) return failure("Provide a reason of at least three characters before voiding a payment.");
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_void_subscription_payment", { target_payment: parsed.data.paymentId, target_reason: parsed.data.reason });
  if (error) return failure("We could not void this subscription payment.");
  revalidatePath("/platform"); revalidatePath("/platform/subscriptions"); revalidatePath("/platform/payments"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`);
  return { ok: true, message: "Payment voided and the subscription balance was recalculated." };
}

const datedLifecycleInput = z.object({ subscriptionId: z.string().uuid(), until: z.string().date(), reason: z.string().trim().min(3).max(500) });
export async function extendSubscriptionTrialAction(input: unknown): Promise<ActionResult> {
  const parsed = datedLifecycleInput.safeParse(input);
  if (!parsed.success) return failure("Provide a valid later trial end date and a reason.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_extend_subscription_trial", { target_subscription: parsed.data.subscriptionId, target_trial_end: parsed.data.until, target_reason: parsed.data.reason });
  if (error) return failure("We could not extend the trial. The new date must be later than the current end date.");
  revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`); return { ok: true, message: "Trial extension recorded." };
}

export async function extendSubscriptionGraceAction(input: unknown): Promise<ActionResult> {
  const parsed = datedLifecycleInput.safeParse(input);
  if (!parsed.success) return failure("Provide a valid later grace end date and a reason.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_extend_subscription_grace", { target_subscription: parsed.data.subscriptionId, target_grace_end: parsed.data.until, target_reason: parsed.data.reason });
  if (error) return failure("We could not extend grace. The new date must be later than the current grace end date.");
  revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`); return { ok: true, message: "Grace extension recorded." };
}

const planChangeInput = z.object({ subscriptionId: z.string().uuid(), planId: z.string().uuid(), billingCycle: z.enum(["monthly", "annual"]) });
export async function scheduleSubscriptionPlanChangeAction(input: unknown): Promise<ActionResult> {
  const parsed = planChangeInput.safeParse(input);
  if (!parsed.success) return failure("Choose a valid future plan and billing cycle.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_schedule_subscription_plan_change", { target_subscription: parsed.data.subscriptionId, target_plan: parsed.data.planId, target_cycle: parsed.data.billingCycle });
  if (error) return failure("We could not schedule the plan change.");
  revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`); return { ok: true, message: "Plan change scheduled for the next billing boundary." };
}

export async function cancelSubscriptionPlanChangeAction(input: unknown): Promise<ActionResult> {
  const parsed = subscriptionIdInput.safeParse(input);
  if (!parsed.success) return failure("A valid subscription is required.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_cancel_subscription_plan_change", { target_subscription: parsed.data.subscriptionId });
  if (error) return failure("There is no scheduled plan change to cancel.");
  revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`); return { ok: true, message: "Scheduled plan change cancelled." };
}

const farmLifecycleInput = z.object({ farmId: z.string().uuid(), subscriptionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });
export async function suspendFarmManuallyAction(input: unknown): Promise<ActionResult> {
  const parsed = farmLifecycleInput.safeParse(input);
  if (!parsed.success) return failure("Provide a reason of at least three characters.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_suspend_farm_manually", { target_farm: parsed.data.farmId, target_reason: parsed.data.reason });
  if (error) return failure("We could not manually suspend this farm.");
  revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`); return { ok: true, message: "Farm manually suspended. Operating access is blocked." };
}

export async function reactivateFarmManuallyAction(input: unknown): Promise<ActionResult> {
  const parsed = farmLifecycleInput.safeParse(input);
  if (!parsed.success) return failure("Provide a reason of at least three characters.");
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_reactivate_farm_manually", { target_farm: parsed.data.farmId, target_reason: parsed.data.reason });
  if (error) return failure("We could not reactivate this farm. A suspended subscription must be settled first.");
  revalidatePath("/platform/subscriptions"); revalidatePath(`/platform/subscriptions/${parsed.data.subscriptionId}`); return { ok: true, message: "Farm access restored." };
}
