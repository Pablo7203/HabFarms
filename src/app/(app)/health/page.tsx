import Link from "next/link";
import { CalendarClock, HeartPulse, Plus, Stethoscope } from "lucide-react";
import { money } from "@/lib/format";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Pagination, pageWindow } from "@/components/ui/pagination";

type Row = { id: string; record_date: string; health_type: string; flock_name?: string; flocks?: { flock_name: string } | null; product_name: string; reason: string | null; next_due_date: string | null; cost: number };

export default async function Health({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireAppContext();
  const supabase = await createClient();
  const params = await searchParams;
  const financial = context.membership.role !== "worker";
  const window = pageWindow(params.page);
  let query = supabase.from("v_upcoming_health_actions").select("*").eq("farm_id", context.farm.id).order("record_date", { ascending: false });
  if (!params.upcoming) query = supabase.from("health_records").select("*,flocks(flock_name)").eq("farm_id", context.farm.id).eq("status", "active").order("record_date", { ascending: false });
  if (params.type) query = query.eq("health_type", params.type);
  if (params.from) query = query.gte("record_date", params.from);
  if (params.to) query = query.lte("record_date", params.to);
  query = query.range(window.from, window.to);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const scheduled = rows.filter((row) => row.next_due_date).length;

  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Farm care</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Health records</h1><p className="mt-2 max-w-xl text-stone-600">Treatments, vaccines and follow-up care across your flocks.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/health/reminders" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"><CalendarClock size={17}/>Health schedule</Link><Link href="/health/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900"><Plus size={18}/>New health record</Link></div>
    </div>

    <section className="grid gap-4 sm:grid-cols-3"><Card className="p-5"><HeartPulse className="text-emerald-700" size={21}/><p className="mt-5 text-sm text-stone-500">Records in this view</p><p className="mt-1 text-3xl font-bold data-number">{rows.length}</p></Card><Card className="p-5"><CalendarClock className="text-amber-700" size={21}/><p className="mt-5 text-sm text-stone-500">With a follow-up</p><p className="mt-1 text-3xl font-bold data-number">{scheduled}</p></Card><Card className="p-5"><Stethoscope className="text-sky-700" size={21}/><p className="mt-5 text-sm text-stone-500">Schedule care</p><p className="mt-1 font-semibold">Use Health schedule for planned activity</p></Card></section>

    <form className="grid gap-3 rounded-[1.35rem] border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-sm font-semibold text-stone-700">From<input name="from" type="date" defaultValue={params.from} className="mt-1.5 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 font-normal"/></label>
      <label className="text-sm font-semibold text-stone-700">To<input name="to" type="date" defaultValue={params.to} className="mt-1.5 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 font-normal"/></label>
      <label className="text-sm font-semibold text-stone-700">Type<select name="type" defaultValue={params.type} className="mt-1.5 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 font-normal"><option value="">All types</option>{["vaccine", "antibiotic", "vitamin", "dewormer", "treatment", "veterinary_service", "other"].map((type) => <option key={type}>{type}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-stone-200 px-3 text-sm font-medium"><input name="upcoming" value="1" defaultChecked={Boolean(params.upcoming)} type="checkbox"/>Upcoming only</label>
      <button className="min-h-11 self-end rounded-xl border border-stone-300 px-5 text-sm font-semibold transition hover:bg-stone-50">Apply filters</button>
    </form>

    <Card className="overflow-hidden"><div className="border-b border-stone-100 px-5 py-4"><h2 className="font-semibold">Care activity</h2><p className="mt-1 text-sm text-stone-500">Open a record for its full treatment and follow-up history.</p></div><div className="divide-y divide-stone-100">{rows.map((row) => <Link key={row.id} href={`/health/${row.id}`} className="grid gap-3 px-5 py-4 transition hover:bg-emerald-50/45 md:grid-cols-[0.9fr_1fr_1.4fr_1fr_auto] md:items-center"><div><p className="text-sm text-stone-500">{row.record_date}</p><p className="mt-1 font-semibold capitalize">{row.health_type.replaceAll("_", " ")}</p></div><p className="font-medium">{row.flock_name ?? row.flocks?.flock_name ?? "Farm record"}</p><div><p>{row.product_name}</p><p className="mt-1 text-sm text-stone-500">{row.reason || "No reason recorded"}</p></div><span className={row.next_due_date ? "font-medium text-amber-800" : "text-stone-500"}>{row.next_due_date ? `Due ${row.next_due_date}` : "No follow-up"}</span>{financial && <p className="font-semibold data-number md:text-right">{money(row.cost, context.farm.currency)}</p>}</Link>)}{!rows.length && <div className="px-6 py-12 text-center"><HeartPulse className="mx-auto text-stone-300" size={28}/><p className="mt-3 font-semibold">No health records match</p><p className="mt-1 text-sm text-stone-500">Record a treatment or adjust your filters.</p></div>}</div></Card>
    <Pagination page={window.page} hasMore={rows.length === 50} base="/health" params={params}/>
  </div>;
}
