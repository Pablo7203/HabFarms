import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

export default async function FlockFeedUsageHistory() {
  const context = await requireAppContext();
  const supabase = await createClient();
  const { data: rows } = await supabase.from("flock_feed_consumptions").select("id,consumption_date,quantity_kg,notes,flocks(flock_name),feed_types(name)").eq("farm_id", context.farm.id).order("consumption_date", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  const canEdit = context.membership.role === "admin" || context.membership.role === "manager";
  return <section><header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6"><div><Link href="/feed" className="text-sm font-semibold text-emerald-800">← Feed inventory</Link><h1 className="mt-3 text-3xl font-bold">Feed use history</h1><p className="mt-2 text-stone-600">Standalone feed issues by flock. Daily production feed entries remain in production records.</p></div><Link href="/feed/usage/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white"><Plus size={17}/>Record feed use</Link></header>
    <div className="mt-6 space-y-3">{rows?.map((row) => { const flock = Array.isArray(row.flocks) ? row.flocks[0] : row.flocks; const feed = Array.isArray(row.feed_types) ? row.feed_types[0] : row.feed_types; return <Card key={row.id} className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5"><div><p className="font-bold text-stone-900">{flock?.flock_name ?? "Flock"} <span className="font-normal text-stone-400">·</span> {feed?.name ?? "Feed"}</p><p className="mt-1 text-sm text-stone-500">{row.consumption_date}{row.notes ? ` · ${row.notes}` : ""}</p></div><div className="flex items-center gap-4"><p className="font-semibold text-stone-900">{Number(row.quantity_kg).toLocaleString()} kg</p>{canEdit && <Link aria-label="Edit feed-use record" title="Edit" href={`/feed/usage/${row.id}/edit`} className="grid size-9 place-items-center rounded-lg border border-stone-200 text-emerald-800 hover:bg-emerald-50"><Pencil size={16}/></Link>}</div></Card>; })}{!rows?.length && <Card className="p-10 text-center text-stone-500">No standalone feed-use entries yet.</Card>}</div>
  </section>;
}
