import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppContext, FarmRole } from "@/types/domain";

export async function getCurrentUser() { const supabase = await createClient(); return (await supabase.auth.getUser()).data.user; }
export async function getCurrentAppContext(): Promise<AppContext | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase.from("farm_members").select("id, farm_id, role").eq("user_id", user.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!membership) return null;
  const [{ data: farm }, { data: profile }] = await Promise.all([
    supabase.from("farms").select("id,name,currency,timezone,crate_size,feed_bag_size_kg,opening_cash_balance").eq("id", membership.farm_id).single(),
    supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle(),
  ]);
  if (!farm) return null;
  return { user: { id: user.id, email: user.email ?? "" }, profile, membership: membership as AppContext["membership"], farm } as AppContext;
}
export async function requireAuth() { const user = await getCurrentUser(); if (!user) redirect("/login"); return user; }
export async function requireAppContext() { await requireAuth(); const context = await getCurrentAppContext(); if (!context) redirect("/onboarding"); return context; }
export async function requireRole(roles: FarmRole[]) { const context = await requireAppContext(); if (!roles.includes(context.membership.role)) redirect("/dashboard"); return context; }
