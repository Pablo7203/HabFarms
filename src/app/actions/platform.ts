"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAuthAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { getCurrentFarmAccount } from "@/lib/auth/context";
import { createFlockAction } from "@/app/actions/operations";
import { platformFarmSchema } from "@/lib/validation/platform";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/auth";

type OwnerInvitation = { id: string; email: string; auth_user_id: string | null; farm_id: string; contact_name: string; status: string };

async function sendExistingAccountInvitation(email: string, origin: string) {
  const client = createStatelessClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/invite-redirect` } });
}

async function getOwnerInvitation(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_get_owner_invitation", { target_invitation: id });
  if (error || !data?.[0]) throw new Error("Owner invitation was not found.");
  return data[0] as OwnerInvitation;
}

async function deliverOwnerInvitation(invitation: OwnerInvitation) {
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  try {
    const admin = createAuthAdminClient();
    if (invitation.auth_user_id) await admin.auth.admin.deleteUser(invitation.auth_user_id);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(invitation.email, { redirectTo: `${origin}/invite-redirect`, data: { invitation_id: invitation.id, platform_owner_invitation: true, full_name: invitation.contact_name } });
    if (!error && data.user?.id) {
      await supabase.rpc("platform_link_owner_invitation_auth_user", { target_invitation: invitation.id, target_auth_user: data.user.id });
      await supabase.rpc("platform_mark_owner_invitation_delivery", { target_invitation: invitation.id, target_delivered: true });
      return { ok: true, message: "Owner invitation sent." };
    }
    if (!/already|registered|exists/i.test(error?.message ?? "")) throw error ?? new Error("Invitation email could not be sent.");
    const { error: existingError } = await sendExistingAccountInvitation(invitation.email, origin);
    if (existingError) throw existingError;
    await supabase.rpc("platform_mark_owner_invitation_delivery", { target_invitation: invitation.id, target_delivered: true });
    return { ok: true, message: "Owner invitation sent. This person can accept it using their existing HabFarms account." };
  } catch {
    await supabase.rpc("platform_mark_owner_invitation_delivery", { target_invitation: invitation.id, target_delivered: false });
    return { ok: false, message: "The farm was created, but the invitation email could not be sent. Use Resend from the farm account." };
  }
}

export async function createPlatformFarmAction(input: unknown): Promise<ActionResult> {
  const parsed = platformFarmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  await requirePlatformAdmin();
  const d = parsed.data, supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_create_farm", { target_farm_name: d.farmName, target_owner_name: d.ownerName, target_owner_email: d.ownerEmail.toLowerCase(), target_owner_phone: d.ownerPhone ?? "", target_country: d.country ?? "", target_internal_notes: d.internalNotes ?? "", target_plan: d.planId, target_trial_enabled: d.trialEnabled, target_trial_days: d.trialDays ?? null, target_billing_cycle: d.billingCycle, target_start_date: d.startDate });
  const created = data?.[0] as { farm_id: string; invitation_id: string } | undefined;
  if (error || !created) return { ok: false, message: "We could not create the customer farm. No partial tenant was created." };
  const delivery = await deliverOwnerInvitation(await getOwnerInvitation(created.invitation_id));
  revalidatePath("/platform"); revalidatePath("/platform/farms"); revalidatePath("/platform/invitations");
  return { ...delivery, id: created.farm_id };
}

export async function resendPlatformOwnerInvitationAction(invitationId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_resend_owner_invitation", { target_invitation: invitationId });
  if (error) return { ok: false, message: error.message.includes("wait") ? "Please wait a minute before resending." : "This owner invitation cannot be resent." };
  const result = await deliverOwnerInvitation(await getOwnerInvitation(invitationId));
  revalidatePath("/platform"); revalidatePath("/platform/farms"); revalidatePath("/platform/invitations");
  return result;
}

export async function revokePlatformOwnerInvitationAction(invitationId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_revoke_owner_invitation", { target_invitation: invitationId });
  if (error) return { ok: false, message: "This owner invitation cannot be revoked." };
  revalidatePath("/platform"); revalidatePath("/platform/farms"); revalidatePath("/platform/invitations");
  return { ok: true, message: "Owner invitation revoked." };
}

async function requireOnboardingOwner() {
  const current = await getCurrentFarmAccount();
  if (!current || current.account.account_status !== "onboarding" || current.account.primary_owner_user_id !== current.context.user.id) throw new Error("Onboarding access denied.");
  return current.context;
}

export async function savePlatformOnboardingSettingsAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ name: z.string().trim().min(2).max(120), currency: z.string().regex(/^[A-Z]{3}$/), timezone: z.string().min(1).max(80), crateSize: z.coerce.number().int().min(1), feedBagSizeKg: z.coerce.number().positive(), openingCashBalance: z.coerce.number().min(0), defaultEggPricePerCrate: z.coerce.number().min(0), defaultLooseEggPrice: z.coerce.number().min(0), feedAlertWarningDays: z.coerce.number().int().min(0), feedAlertCriticalDays: z.coerce.number().int().min(0), averageFeedDaysWindow: z.coerce.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const context = await requireOnboardingOwner(), d = parsed.data, supabase = await createClient();
  const { error } = await supabase.rpc("update_farm_configuration", { target_farm_id: context.farm.id, farm_name: d.name, farm_currency: d.currency, farm_timezone: d.timezone, farm_crate_size: d.crateSize, farm_feed_bag_size_kg: d.feedBagSizeKg, farm_opening_cash_balance: d.openingCashBalance, egg_price_per_crate: d.defaultEggPricePerCrate, loose_egg_price: d.defaultLooseEggPrice, warning_days: d.feedAlertWarningDays, critical_days: d.feedAlertCriticalDays, average_days: d.averageFeedDaysWindow });
  if (error) return { ok: false, message: "We could not save your farm settings." };
  const { error: milestoneError } = await supabase.rpc("mark_platform_onboarding_settings", { target_farm: context.farm.id });
  if (milestoneError) return { ok: false, message: "Farm settings were saved, but onboarding progress could not be updated." };
  revalidatePath("/onboarding"); return { ok: true, message: "Farm settings saved." };
}

export async function createPlatformOnboardingFlockAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const context = await requireOnboardingOwner(); const result = await createFlockAction(input);
  if (!result.ok) return result;
  const supabase = await createClient(); const { error } = await supabase.rpc("mark_platform_onboarding_first_flock", { target_farm: context.farm.id });
  if (error) return { ok: false, message: "Flock created, but onboarding progress could not be updated.", id: result.id };
  revalidatePath("/onboarding"); return result;
}

export async function skipPlatformOnboardingStepAction(step: "first_flock" | "opening_stock"): Promise<ActionResult> { const context = await requireOnboardingOwner(), supabase = await createClient(); const { error } = await supabase.rpc("skip_platform_onboarding_step", { target_farm: context.farm.id, target_step: step }); if (error) return { ok: false, message: "That onboarding step could not be skipped." }; revalidatePath("/onboarding"); return { ok: true, message: "Step skipped. You can complete it later from your farm workspace." }; }

export async function completePlatformOnboardingAction(): Promise<ActionResult> { const context = await requireOnboardingOwner(), supabase = await createClient(); const { error } = await supabase.rpc("complete_platform_onboarding", { target_farm: context.farm.id }); if (error) return { ok: false, message: "Complete your required settings before finishing onboarding." }; revalidatePath("/onboarding"); revalidatePath("/dashboard"); return { ok: true, message: "Your farm is ready." }; }
