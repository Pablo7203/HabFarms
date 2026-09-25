"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { deliverPlatformCommunications, sendPlatformTestEmail } from "@/lib/platform/communications";
import type { ActionResult } from "@/app/actions/auth";

const settingsSchema = z.object({
  companyName: z.string().trim().min(2).max(120), supportName: z.string().trim().max(120).optional(),
  supportEmail: z.string().trim().email().max(254).optional().or(z.literal("")), supportPhone: z.string().trim().max(80).optional(),
  billingContactEmail: z.string().trim().email().max(254).optional().or(z.literal("")), defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  defaultTrialDays: z.coerce.number().int().min(0).max(365), defaultGraceDays: z.coerce.number().int().min(0).max(365),
  trialReminderDays: z.coerce.number().int().min(0).max(90), dueReminderDays: z.coerce.number().int().min(0).max(90),
  graceReminderDays: z.coerce.number().int().min(0).max(90), timezone: z.string().trim().min(1).max(80),
});

export async function updatePlatformSettingsAction(input: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  await requirePlatformAdmin();
  const value = parsed.data;
  const { error } = await (await createClient()).rpc("platform_update_settings", {
    target_company_name: value.companyName, target_support_name: value.supportName ?? "", target_support_email: value.supportEmail ?? "", target_support_phone: value.supportPhone ?? "", target_billing_contact_email: value.billingContactEmail ?? "", target_default_currency: value.defaultCurrency, target_default_trial_days: value.defaultTrialDays, target_default_grace_days: value.defaultGraceDays, target_trial_reminder_days: value.trialReminderDays, target_due_reminder_days: value.dueReminderDays, target_grace_reminder_days: value.graceReminderDays, target_timezone: value.timezone,
  });
  if (error) return { ok: false, message: "We could not save Platform settings." };
  revalidatePath("/platform"); revalidatePath("/platform/settings");
  return { ok: true, message: "Platform settings saved. Existing customer snapshots were not changed." };
}

export async function createPlatformAccountNoteAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ farmId: z.string().uuid(), note: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a note of up to 2,000 characters." };
  await requirePlatformAdmin();
  const { error } = await (await createClient()).rpc("platform_create_account_note", { target_farm: parsed.data.farmId, target_note: parsed.data.note });
  if (error) return { ok: false, message: "We could not save this internal account note." };
  revalidatePath(`/platform/farms/${parsed.data.farmId}`); revalidatePath("/platform/audit");
  return { ok: true, message: "Internal note saved." };
}

export async function retryPlatformCommunicationsAction(): Promise<ActionResult> {
  await requirePlatformAdmin();
  const result = await deliverPlatformCommunications();
  revalidatePath("/platform"); revalidatePath("/platform/operations"); revalidatePath("/platform/audit");
  if (!result.providerConfigured) return { ok: false, message: "No lifecycle email provider is configured. Messages remain pending; add RESEND_API_KEY and PLATFORM_EMAIL_FROM on the server first." };
  return { ok: true, message: `Delivery run complete: ${result.sent} sent, ${result.failed} failed, ${result.pending} still pending.` };
}

export async function sendPlatformTestEmailAction(): Promise<ActionResult> {
  await requirePlatformAdmin();
  if (process.env.PLATFORM_EMAIL_TEST_ENABLED !== "true") return { ok: false, message: "The one-message email test is disabled in this environment." };
  if (!process.env.PLATFORM_ALERT_EMAIL) return { ok: false, message: "The operations alert recipient is not configured." };
  const result = await sendPlatformTestEmail();
  if (!result.providerConfigured) return { ok: false, message: "Email delivery is not configured for this environment." };
  if (!result.accepted) return { ok: false, message: "The test message was not accepted. Check the secure provider logs; no customer messages were changed." };
  return { ok: true, message: "Resend accepted one test email to the configured operations contact. Check that inbox and Resend logs; acceptance does not guarantee inbox delivery." };
}
