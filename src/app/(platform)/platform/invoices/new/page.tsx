import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PlatformManualInvoiceForm } from "@/components/forms/platform-manual-invoice-form";
import { createClient } from "@/lib/supabase/server";

type FarmRow = { farm_id: string; farm_name: string; owner_name: string; owner_email: string; currency: string | null; total_count: number };
type Customer = { farm_id: string; farm_name: string; owner_name: string; owner_email: string; currency: string | null };

export default async function NewPlatformManualInvoice({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; farmId?: string }> }) {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const supabase = await createClient();
  if (query.farmId) {
    const [{ data: farmData }, { data: subscriptionData }, { data: settingsData }] = await Promise.all([
      supabase.rpc("platform_get_farm_detail", { target_farm: query.farmId }),
      supabase.from("farm_subscriptions").select("currency").eq("farm_id", query.farmId).is("ended_at", null).limit(1).maybeSingle(),
      supabase.rpc("platform_get_settings"),
    ]);
    const farm = (farmData ?? [])[0];
    if (!farm) notFound();
    const settings = (Array.isArray(settingsData) ? settingsData[0] : settingsData) as { default_currency?: string } | null;
    const customer = { farm_id: farm.farm_id, farm_name: farm.farm_name, owner_name: farm.contact_name, owner_email: farm.contact_email, currency: subscriptionData?.currency ?? null } as Customer;
    return <div className="mx-auto max-w-3xl"><Link href="/platform/invoices" className="text-sm font-semibold text-emerald-800">← Manual invoices</Link><h1 className="mt-3 text-3xl font-bold tracking-tight">Create manual invoice</h1><p className="mt-2 text-stone-600">Issue a one-off charge to this customer. Billing details are snapshotted when issued.</p><Card className="mt-6 p-5 sm:p-7"><PlatformManualInvoiceForm customer={customer} defaultCurrency={subscriptionData?.currency ?? settings?.default_currency ?? "GHS"} /></Card></div>;
  }

  const { data } = await supabase.rpc("platform_farm_portfolio", {
    target_search: query.q?.trim() || null, target_account_status: null,
    target_subscription_status: null, target_plan: null, target_onboarding_status: null,
    target_limit: 25, target_offset: (page - 1) * 25,
  });
  const farms = (data ?? []) as FarmRow[];
  const total = Number(farms[0]?.total_count ?? 0);
  const maxPage = Math.max(1, Math.ceil(total / 25));
  return <div className="mx-auto max-w-4xl"><Link href="/platform/invoices" className="text-sm font-semibold text-emerald-800">← Manual invoices</Link><h1 className="mt-3 text-3xl font-bold tracking-tight">Choose a customer</h1><p className="mt-2 text-stone-600">Select the farm that should receive this one-off invoice.</p><form className="mt-5 flex flex-wrap gap-2"><input name="q" defaultValue={query.q} className="min-h-11 min-w-60 flex-1 rounded-xl border bg-white px-3" placeholder="Search farm, owner, email, or phone" /><button className="min-h-11 rounded-xl border bg-white px-4 text-sm font-semibold">Search</button></form><Card className="mt-4 divide-y overflow-hidden">{farms.map((farm) => <div key={farm.farm_id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{farm.farm_name}</p><p className="mt-1 text-sm text-stone-600">{farm.owner_name} · {farm.owner_email}</p></div><Link href={`/platform/invoices/new?farmId=${farm.farm_id}`} className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-semibold hover:bg-lime-50">Select customer</Link></div>)}{!farms.length && <p className="p-6 text-sm text-stone-600">No customer farms found for that search.</p>}</Card><div className="mt-4 flex items-center justify-between text-sm"><Link aria-disabled={page <= 1} className="rounded-lg border bg-white px-3 py-2 aria-disabled:pointer-events-none aria-disabled:opacity-40" href={`/platform/invoices/new?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), page: String(page - 1) })}`}>Previous</Link><span className="text-stone-600">{total} customer farms · page {page} of {maxPage}</span><Link aria-disabled={page >= maxPage} className="rounded-lg border bg-white px-3 py-2 aria-disabled:pointer-events-none aria-disabled:opacity-40" href={`/platform/invoices/new?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), page: String(page + 1) })}`}>Next</Link></div></div>;
}
