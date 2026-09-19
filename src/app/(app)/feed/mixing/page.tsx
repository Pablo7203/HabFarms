import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { FeedMixingForm } from "@/components/forms/feed-forms";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/format";

export default async function Mixing() {
  const c = await requireRole(["admin", "manager"]), s = await createClient();
  const [{ data: types }, { data: batches }] = await Promise.all([
    s.from("feed_types").select("id,name,default_bag_size_kg").eq("farm_id", c.farm.id).eq("active", true).order("name"),
    s.from("feed_mixing_batches").select("id,mixed_on,output_kg,material_cost,cost_per_kg,feed_types!feed_mixing_batches_output_feed_type_id_fkey(name)").eq("farm_id", c.farm.id).order("mixed_on", { ascending: false }).limit(20),
  ]);
  return <div><h1 className="text-3xl font-bold">Feed mixing batches</h1><p className="mt-2 text-stone-600">Turn ingredients already in stock into finished feed at their recorded material cost.</p><Card className="mt-6 p-5 sm:p-7">{(types ?? []).length > 1 ? <FeedMixingForm types={types ?? []} today={farmToday(c.farm.timezone)} /> : <p className="text-sm text-stone-600">Create at least two feed types before recording a mixing batch.</p>}</Card><h2 className="mt-8 text-xl font-semibold">Recent batches</h2><Card className="mt-4 divide-y">{batches?.map(b => <div key={b.id} className="flex flex-wrap justify-between gap-3 p-5"><div><p className="font-semibold">{b.feed_types?.[0]?.name ?? "Finished feed"}</p><p className="text-sm text-stone-500">{b.mixed_on} · {b.output_kg} kg</p></div><p className="text-right text-sm">Material cost <b className="block">{money(b.material_cost, c.farm.currency)}</b><span className="text-stone-500">{money(b.cost_per_kg, c.farm.currency)}/kg</span></p></div>)}{!batches?.length && <p className="p-5 text-sm text-stone-500">No feed mixing batches recorded.</p>}</Card></div>;
}
