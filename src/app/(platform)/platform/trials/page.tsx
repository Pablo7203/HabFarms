import Link from "next/link";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type Trial = { subscription_id: string; farm_name: string; owner_name: string; plan_name: string; trial_ends_at: string | null; days_remaining: number | null };

export default async function PlatformTrials({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const query = await searchParams;
  const includeAll = query.window === "all";
  const windowDays = query.window === "30" ? 30 : 7;
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_trial_portfolio", { target_window_days: windowDays, target_include_all: includeAll, target_limit: 100, target_offset: 0 });
  const trials = (data ?? []) as Trial[];
  return <div><p className="text-sm font-semibold text-emerald-800">Commercial accounts</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Trials</h1><p className="mt-2 text-stone-600">Trial state comes from the current subscription lifecycle, not inferred from historic dates.</p><div className="mt-6 flex gap-2"><Link href="/platform/trials" className="rounded-lg border px-3 py-2 text-sm font-semibold">Next 7 days</Link><Link href="/platform/trials?window=30" className="rounded-lg border px-3 py-2 text-sm font-semibold">Next 30 days</Link><Link href="/platform/trials?window=all" className="rounded-lg border px-3 py-2 text-sm font-semibold">All trials</Link></div><Card className="mt-5 overflow-hidden"><div className="hidden grid-cols-[1.2fr_1fr_1fr_.8fr] gap-4 border-b bg-stone-50 p-4 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid"><span>Farm</span><span>Owner / plan</span><span>Trial end</span><span>Days remaining</span></div>{trials.map((trial) => <Link key={trial.subscription_id} href={`/platform/subscriptions/${trial.subscription_id}`} className="grid gap-2 border-b p-4 hover:bg-lime-50 md:grid-cols-[1.2fr_1fr_1fr_.8fr] md:items-center md:gap-4"><p className="font-semibold">{trial.farm_name}</p><p className="text-sm">{trial.owner_name}<br /><span className="text-stone-500">{trial.plan_name}</span></p><p className="text-sm">{trial.trial_ends_at ?? "—"}</p><p className="font-semibold">{trial.days_remaining == null ? "—" : trial.days_remaining < 0 ? `${Math.abs(trial.days_remaining)} days overdue` : `${trial.days_remaining} days`}</p></Link>)}{!trials.length && <p className="p-8 text-sm text-stone-600">No trial subscriptions match this window.</p>}</Card></div>;
}
