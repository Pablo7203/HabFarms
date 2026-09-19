import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatFarmDate } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { ChickenBadge } from "@/components/ui/chicken-icon";

export const metadata = { title: "Flocks" };

export default async function FlocksPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await requireAppContext();
  const supabase = await createClient();
  const filter = (await searchParams).status ?? "active";
  let query = supabase.from("v_current_flock_status").select("*").eq("farm_id", context.farm.id).order("flock_name");
  if (filter !== "all") query = query.eq("status", filter);
  const [{ data: rows }, { data: flockData }] = await Promise.all([query, supabase.from("flocks").select("id,start_date,batch_reference,house_pen").eq("farm_id", context.farm.id)]);
  const details = new Map(flockData?.map((flock) => [flock.id, flock]));
  const canManage = context.membership.role !== "worker";

  return <section aria-labelledby="flocks-heading">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-stone-200/90 pb-6">
      <div className="max-w-xl">
        <p className="text-sm font-semibold tracking-[0.08em] text-emerald-800">Farm operations</p>
        <h1 id="flocks-heading" className="mt-2 text-4xl font-bold tracking-[-0.04em] text-stone-900 sm:text-5xl">Flocks</h1>
        <p className="mt-3 text-pretty leading-7 text-stone-600">Each flock is a living operational record. Bird counts are calculated from the movement ledger, not typed in manually.</p>
      </div>
      {canManage && <Link href="/flocks/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_-18px_rgba(6,78,59,0.9)] hover:-translate-y-px hover:bg-emerald-800"><Plus size={18} />New flock</Link>}
    </header>

    <nav className="mt-6 flex flex-wrap gap-2" aria-label="Flock status filter">
      {["active", "closed", "all"].map((value) => <Link key={value} href={`/flocks?status=${value}`} aria-current={filter === value ? "page" : undefined} className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize ${filter === value ? "bg-emerald-800 text-white shadow-[0_8px_20px_-16px_rgba(6,78,59,0.9)]" : "border border-stone-200 bg-white/70 text-stone-600 hover:border-stone-300 hover:bg-white"}`}>{value}</Link>)}
    </nav>

    <div className="mt-7 grid gap-4">
      {rows?.map((row) => {
        const flock = details.get(row.flock_id);
        return <Link key={row.flock_id} href={`/flocks/${row.flock_id}`} className="group block focus-visible:rounded-[1.35rem]">
          <Card className="grid gap-5 p-5 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-emerald-300 group-hover:shadow-[0_20px_38px_-30px_rgba(6,78,59,0.6)] sm:grid-cols-[minmax(13rem,2fr)_repeat(3,minmax(7rem,1fr))] sm:items-end sm:p-6">
            <div className="flex items-start gap-3"><ChickenBadge size={42} className="mt-0.5 shrink-0"/><div><p className="text-xs font-semibold tracking-[0.08em] text-emerald-800">{row.status}</p><h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-stone-900">{row.flock_name}</h2><p className="mt-2 text-sm text-stone-500">{flock?.batch_reference || "No batch reference"} <span aria-hidden="true">·</span> {flock?.house_pen || "No pen assigned"}</p></div></div>
            <FlockMetric label="Started" value={flock ? formatFarmDate(flock.start_date) : "—"} />
            <FlockMetric label="Initial birds" value={row.initial_birds} />
            <FlockMetric label="Live birds" value={row.current_live_birds} emphasis />
          </Card>
        </Link>;
      })}
      {!rows?.length && <Card className="p-10 text-center sm:p-14"><ChickenBadge size={68} className="mx-auto"/><p className="mt-4 text-lg font-bold tracking-[-0.02em]">No {filter === "all" ? "" : filter} flocks yet</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">Create a flock to begin recording production, mortality, feed consumption, and health activity.</p>{canManage && <Link href="/flocks/new" className="mt-6 inline-flex rounded-lg text-sm font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950">Create your first flock</Link>}</Card>}
    </div>
  </section>;
}

function FlockMetric({ label, value, emphasis = false }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return <div><p className="text-xs font-semibold tracking-[0.06em] text-stone-500">{label}</p><p className={`data-number mt-2 text-lg font-bold ${emphasis ? "text-emerald-800" : "text-stone-900"}`}>{value}</p></div>;
}
