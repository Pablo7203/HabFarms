import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

type SubscriptionStatus = { account_status: string; access_mode: string; plan_name: string | null; currency: string | null; subscription_status: string | null; billing_cycle: string | null; current_period_start: string | null; current_period_end: string | null; next_billing_date: string | null; trial_ends_at: string | null; grace_ends_at: string | null; amount_due: number | string | null; amount_paid: number | string | null; outstanding: number | string | null; can_view_financials: boolean };

export const metadata = { title: "Subscription" };

export default async function SubscriptionPage() {
  const context = await requireRole(["admin"]);
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_subscription_status", { target_farm: context.farm.id });
  const status = (data?.[0] ?? null) as SubscriptionStatus | null;
  if (!status) return <div><h1 className="text-3xl font-bold tracking-tight">Subscription</h1><p className="mt-3 text-stone-600">Subscription details are not available for this farm yet.</p></div>;
  const currency = status.currency ?? context.farm.currency;
  const date = status.subscription_status === "trialing" ? status.trial_ends_at : status.next_billing_date;
  return <div className="mx-auto max-w-4xl"><Link href="/settings" className="text-sm font-semibold text-emerald-800">← Back to farm settings</Link><div className="mt-4"><p className="text-sm font-semibold text-emerald-800">Account</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Subscription</h1><p className="mt-2 text-stone-600">Your farm’s HabFarms plan and account access. This is separate from your farm’s cash, expenses, and profitability records.</p></div><div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Card className="p-5"><p className="text-sm text-stone-500">Plan</p><p className="mt-2 text-xl font-semibold">{status.plan_name ?? "Not configured"}</p><p className="mt-1 capitalize text-sm text-stone-600">{status.billing_cycle ?? "—"}</p></Card><Card className="p-5"><p className="text-sm text-stone-500">Subscription status</p><p className="mt-2 text-xl font-semibold capitalize">{status.subscription_status?.replace("_", " ") ?? "Not configured"}</p><p className="mt-1 text-sm text-stone-600">{date ? `${status.subscription_status === "trialing" ? "Trial ends" : "Next billing"} ${date}` : "No billing date"}</p></Card><Card className="p-5"><p className="text-sm text-stone-500">Account access</p><p className="mt-2 text-xl font-semibold capitalize">{status.account_status.replace("_", " ")}</p><p className="mt-1 text-sm text-stone-600">{status.access_mode === "full" ? "Farm access is available." : "Contact HabFarms support for account assistance."}</p></Card></div>{status.can_view_financials && <Card className="mt-5 p-5"><h2 className="font-semibold">Current billing period</h2><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><p className="text-sm text-stone-500">Amount due</p><p className="mt-1 text-lg font-semibold">{money(status.amount_due ?? 0, currency)}</p></div><div><p className="text-sm text-stone-500">Payments recorded</p><p className="mt-1 text-lg font-semibold">{money(status.amount_paid ?? 0, currency)}</p></div><div><p className="text-sm text-stone-500">Outstanding</p><p className="mt-1 text-lg font-semibold">{money(status.outstanding ?? 0, currency)}</p></div></div><p className="mt-4 text-sm text-stone-600">For payment support or a receipt query, contact HabFarms. Farm staff cannot view platform billing.</p></Card>}</div>;
}
