import Link from "next/link";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Renewal = { subscription_id: string; farm_name: string; owner_name: string; plan_name: string; billing_cycle: string; currency: string; next_billing_date: string; expected_amount: number | string | null };

export default async function Renewals({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const query = await searchParams;
  const windowDays = query.window === "30" ? 30 : 7;
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_upcoming_renewals", { target_window_days: windowDays, target_limit: 100, target_offset: 0 });
  const rows = (data ?? []) as Renewal[];
  return <div><p className="text-sm font-semibold text-emerald-800">Commercial accounts</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Upcoming renewals</h1><p className="mt-2 text-stone-600">Renewal dates are obligations, not automatic payment instructions. Amounts use the subscription price snapshot.</p><div className="mt-6 flex gap-2"><Link href="/platform/renewals" className="rounded-lg border px-3 py-2 text-sm font-semibold">Next 7 days</Link><Link href="/platform/renewals?window=30" className="rounded-lg border px-3 py-2 text-sm font-semibold">Next 30 days</Link></div><Card className="mt-5 overflow-hidden"><div className="hidden grid-cols-5 gap-3 border-b bg-stone-50 p-4 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid"><span>Farm</span><span>Owner / plan</span><span>Cycle</span><span>Renewal date</span><span>Expected amount</span></div>{rows.map((row) => <Link key={row.subscription_id} href={`/platform/subscriptions/${row.subscription_id}`} className="grid gap-2 border-b p-4 hover:bg-lime-50 md:grid-cols-5 md:items-center md:gap-3"><p className="font-semibold">{row.farm_name}</p><p className="text-sm">{row.owner_name}<br /><span className="text-stone-500">{row.plan_name}</span></p><p className="capitalize text-sm">{row.billing_cycle}</p><p>{row.next_billing_date}</p><p className="font-semibold">{row.expected_amount == null ? "Price snapshot unavailable" : money(row.expected_amount, row.currency)}</p></Link>)}{!rows.length && <p className="p-8 text-sm text-stone-600">No renewals fall within this window.</p>}</Card></div>;
}
