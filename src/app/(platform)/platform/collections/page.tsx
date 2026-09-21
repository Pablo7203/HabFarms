import Link from "next/link";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

type Collection = { billing_period_id: string; subscription_id: string; farm_name: string; owner_name: string; plan_name: string; collection_status: string; due_date: string; amount_due: number | string; amount_paid: number | string; outstanding: number | string; currency: string };
const filters = [["All", ""], ["Due soon", "due_soon"], ["Past due", "past_due"], ["Grace", "grace_period"], ["Suspended", "suspended"], ["Paid", "paid"]] as const;

export default async function PlatformCollections({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const query = await searchParams;
  const status = filters.some(([, value]) => value === query.status) ? query.status ?? null : null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_subscription_collections", { target_category: status, target_limit: 100, target_offset: 0 });
  const rows = (data ?? []) as Collection[];
  return <div><p className="text-sm font-semibold text-emerald-800">HabFarms receivables</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Subscription collections</h1><p className="mt-2 text-stone-600">Platform subscription receivables only—not farm customer collections.</p><div className="mt-6 flex flex-wrap gap-2">{filters.map(([label, value]) => <Link key={label} href={value ? `/platform/collections?status=${value}` : "/platform/collections"} className="rounded-lg border px-3 py-2 text-sm font-semibold">{label}</Link>)}</div><Card className="mt-5 overflow-hidden"><div className="hidden grid-cols-[1.25fr_1fr_.9fr_.8fr_.8fr_.8fr] gap-3 border-b bg-stone-50 p-4 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid"><span>Farm</span><span>Plan / status</span><span>Due date</span><span>Due</span><span>Paid</span><span>Outstanding</span></div>{rows.map((row) => <Link key={row.billing_period_id} href={`/platform/subscriptions/${row.subscription_id}`} className="grid gap-2 border-b p-4 hover:bg-lime-50 md:grid-cols-[1.25fr_1fr_.9fr_.8fr_.8fr_.8fr] md:items-center md:gap-3"><div><p className="font-semibold">{row.farm_name}</p><p className="text-sm text-stone-500">{row.owner_name}</p></div><p className="text-sm">{row.plan_name}<br /><span className="capitalize text-stone-500">{row.collection_status.replace("_", " ")}</span></p><p className="text-sm">{row.due_date}</p><p>{money(row.amount_due, row.currency)}</p><p>{money(row.amount_paid, row.currency)}</p><p className="font-semibold">{money(row.outstanding, row.currency)}</p></Link>)}{!rows.length && <p className="p-8 text-sm text-stone-600">No subscription collections match this category.</p>}</Card></div>;
}
