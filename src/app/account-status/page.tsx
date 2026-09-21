import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getCurrentFarmAccount, requireAuth } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata = { title: "Farm account status" };

export default async function AccountStatusPage() {
  await requireAuth();
  const current = await getCurrentFarmAccount();
  if (!current) redirect("/onboarding");
  if (current.accessMode !== "blocked") redirect(current.account.account_status === "onboarding" ? "/onboarding" : "/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_subscription_status", { target_farm: current.context.farm.id });
  const status = data?.[0] as {
    plan_name: string | null; subscription_status: string | null; grace_ends_at: string | null;
    outstanding: number | null; can_view_financials: boolean;
  } | undefined;
  const isAdmin = current.context.membership.role === "admin";

  return <main className="min-h-screen bg-[#edf2e7] px-4 py-10 sm:px-6"><Card className="mx-auto max-w-xl p-6 sm:p-8"><p className="text-sm font-semibold text-emerald-800">HabFarms account</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Farm operations are temporarily unavailable</h1><p className="mt-3 text-stone-600">{isAdmin ? "Your farm’s HabFarms subscription requires attention. Contact HabFarms to restore operational access." : "This farm’s HabFarms account is currently unavailable. Contact your farm administrator."}</p>{isAdmin && status && <div className="mt-6 grid gap-4 rounded-2xl bg-stone-50 p-5 text-sm sm:grid-cols-2"><div><p className="text-stone-500">Plan</p><p className="mt-1 font-semibold">{status.plan_name ?? "HabFarms"}</p></div><div><p className="text-stone-500">Subscription status</p><p className="mt-1 font-semibold capitalize">{status.subscription_status?.replace("_", " ") ?? "Unavailable"}</p></div>{status.can_view_financials && status.outstanding != null && <div><p className="text-stone-500">Outstanding</p><p className="mt-1 font-semibold">{money(status.outstanding, current.context.farm.currency)}</p></div>}{status.grace_ends_at && <div><p className="text-stone-500">Grace access ended</p><p className="mt-1 font-semibold">{status.grace_ends_at}</p></div>}</div>}<div className="mt-7 flex flex-wrap gap-3"><Link href="/login" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white">Return to sign in</Link><Link href="/" className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700">Home</Link></div></Card></main>;
}
