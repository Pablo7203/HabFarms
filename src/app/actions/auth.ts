"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema } from "@/lib/validation/auth";
import { userMessage } from "@/lib/utils";
export type ActionResult = { ok: boolean; message: string; id?: string; nextPath?: string };

export async function switchActiveFarmAction(farmId: string): Promise<ActionResult> {
  const user = await createClient().then(async (supabase) => (await supabase.auth.getUser()).data.user);
  if (!user) return { ok: false, message: "Sign in to switch farms." };
  const supabase = await createClient();
  const { data: membership } = await supabase.from("farm_members").select("farm_id").eq("farm_id", farmId).eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!membership) return { ok: false, message: "You do not have access to that farm." };
  (await cookies()).set("habfarms_active_farm", farmId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  const { data: account } = await supabase
    .from("farm_accounts")
    .select("account_status,primary_owner_user_id")
    .eq("farm_id", farmId)
    .maybeSingle();
  const nextPath = account?.account_status === "onboarding" && account.primary_owner_user_id === user.id
    ? "/onboarding"
    : "/dashboard";
  return { ok: true, message: "Farm switched.", nextPath };
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input); if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient(); const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: "Email or password is incorrect." }; redirect("/dashboard");
}
export async function signupAction(input: unknown): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(input); if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient(); const { error } = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { data: { full_name: parsed.data.fullName }, emailRedirectTo: `${origin}/auth/callback` } });
  if (error) return { ok: false, message: error.message.includes("registered") ? "An account already exists for this email." : userMessage(error) };
  return { ok: true, message: "Account created. Check your email to confirm your address, then sign in." };
}
export async function forgotPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input); if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const origin = (await headers()).get("origin") ?? "http://localhost:3000"; const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  if (error) return { ok: false, message: userMessage(error) }; return { ok: true, message: "If an account exists, a reset link has been sent." };
}
export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input); if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient(); const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: userMessage(error) }; return { ok: true, message: "Password updated. You can continue to your dashboard." };
}
export async function logoutAction() { const supabase = await createClient(); await supabase.auth.signOut(); redirect("/login"); }
