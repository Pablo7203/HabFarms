import Link from "next/link";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Row = {
  farm_id: string; farm_name: string; owner_name: string; owner_email: string; account_status: string;
  subscription_status: string | null; plan_name: string | null; onboarding_percentage: number; user_count: number;
  next_billing_date: string | null; outstanding: number | string; currency: string | null; created_at: string; total_count: number;
};

export default async function PlatformFarms({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; subscription?: string; page?: string }> }) {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = 25;
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_farm_portfolio", {
    target_search: query.q?.trim() || null, target_account_status: query.status || null,
    target_subscription_status: query.subscription || null, target_plan: null, target_onboarding_status: null,
    target_limit: limit, target_offset: (page - 1) * limit,
  });
  const farms = (data ?? []) as Row[];
  const total = farms[0]?.total_count ?? 0;
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q); if (query.status) params.set("status", query.status); if (query.subscription) params.set("subscription", query.subscription);
  const href = (nextPage: number) => `/platform/farms?${new URLSearchParams({ ...Object.fromEntries(params), page: String(nextPage) })}`;
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight">Customer farms</h1><p className="mt-2 text-stone-600">Server-filtered customer account portfolio. Farm operational data remains private.</p></div><Link href="/platform/farms/new" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-800 px-4 font-semibold text-white">Create farm</Link></div>
    <form className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-4"><label className="text-sm font-medium">Search<input name="q" defaultValue={query.q} className="mt-2 min-h-11 w-full rounded-xl border px-3" placeholder="Farm, owner, email, phone" /></label><label className="text-sm font-medium">Account<select name="status" defaultValue={query.status ?? ""} className="mt-2 min-h-11 w-full rounded-xl border bg-white px-3"><option value="">All</option>{["invited", "onboarding", "active", "suspended", "closed"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-sm font-medium">Subscription<select name="subscription" defaultValue={query.subscription ?? ""} className="mt-2 min-h-11 w-full rounded-xl border bg-white px-3"><option value="">All</option>{["trialing", "active", "past_due", "grace_period", "suspended", "cancelled"].map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</select></label><div className="flex items-end"><button className="min-h-11 rounded-xl border px-4 text-sm font-semibold">Apply</button></div></form>
    <p className="mt-4 text-sm text-stone-600">{total} customer farms</p>
    <Card className="mt-3 overflow-hidden"><div className="hidden grid-cols-[1.3fr_1.2fr_1fr_.8fr_.8fr_.8fr] gap-3 border-b bg-stone-50 p-4 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid"><span>Farm</span><span>Owner</span><span>Commercial status</span><span>Users</span><span>Next billing</span><span>Outstanding</span></div>{farms.map((farm) => <Link key={farm.farm_id} href={`/platform/farms/${farm.farm_id}`} className="grid gap-2 border-b p-4 hover:bg-lime-50 md:grid-cols-[1.3fr_1.2fr_1fr_.8fr_.8fr_.8fr] md:items-center md:gap-3"><div><p className="font-semibold">{farm.farm_name}</p><p className="text-xs text-stone-500">Created {new Date(farm.created_at).toLocaleDateString()}</p></div><p className="text-sm">{farm.owner_name}<br /><span className="text-stone-500">{farm.owner_email}</span></p><p className="capitalize text-sm">{farm.account_status} · {farm.subscription_status?.replace("_", " ") ?? "—"}<br /><span className="text-stone-500">{farm.plan_name ?? "No plan"} · {farm.onboarding_percentage}%</span></p><p>{farm.user_count}</p><p>{farm.next_billing_date ?? "—"}</p><p className="font-semibold">{farm.currency ? money(farm.outstanding, farm.currency) : "—"}</p></Link>)}{!farms.length && <p className="p-8 text-sm text-stone-600">No customer farms match these filters.</p>}</Card>
    <div className="mt-5 flex items-center justify-between"><Link aria-disabled={page === 1} className="rounded-lg border px-3 py-2 text-sm font-semibold aria-disabled:pointer-events-none aria-disabled:opacity-40" href={href(page - 1)}>Previous</Link><span className="text-sm text-stone-600">Page {page} of {Math.max(1, Math.ceil(total / limit))}</span><Link aria-disabled={page * limit >= total} className="rounded-lg border px-3 py-2 text-sm font-semibold aria-disabled:pointer-events-none aria-disabled:opacity-40" href={href(page + 1)}>Next</Link></div>
  </div>;
}
