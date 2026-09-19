import Link from "next/link";
import { ArrowUpRight, Egg, PackageCheck, Tags } from "lucide-react";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatFarmDate } from "@/lib/farm-date";
import { money } from "@/lib/reporting";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChickenBadge } from "@/components/ui/chicken-icon";

export const metadata = { title: "Egg inventory" };

export default async function EggsPage() {
  const context = await requireAppContext();
  const supabase = await createClient();
  const commercial = context.membership.role !== "worker";
  const [inventoryResult, movesResult, pricesResult, batchesResult] = await Promise.all([
    supabase.from("v_current_egg_inventory_by_grade").select("*").eq("farm_id", context.farm.id).order("sort_order"),
    supabase.from("egg_inventory_movements").select("*,egg_grades(name)").eq("farm_id", context.farm.id).order("movement_date", { ascending: false }).limit(20),
    commercial ? supabase.from("v_current_egg_grade_prices").select("*").eq("farm_id", context.farm.id) : Promise.resolve({ data: [], error: null }),
    supabase.from("egg_grading_batches").select("*").eq("farm_id", context.farm.id).order("grading_date", { ascending: false }).limit(10),
  ]);

  if (inventoryResult.error || movesResult.error || pricesResult.error || batchesResult.error) {
    throw new Error("Could not load egg inventory");
  }

  const inventory = inventoryResult.data ?? [];
  const moves = movesResult.data ?? [];
  const prices = pricesResult.data ?? [];
  const batches = batchesResult.data ?? [];
  const batchIds = batches.map((batch) => batch.id);
  const { data: allocations, error: allocationsError } = batchIds.length
    ? await supabase.from("egg_grading_allocations").select("grading_batch_id,target_grade_id,quantity_eggs").in("grading_batch_id", batchIds)
    : { data: [], error: null };

  if (allocationsError) throw new Error("Could not load egg grading history");

  const gradeNames = new Map(inventory.map((grade) => [grade.egg_grade_id, grade.grade_name]));
  const total = inventory.reduce((sum, grade) => sum + Number(grade.total_eggs), 0);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Inventory control</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Egg inventory</h1>
          <p className="mt-2 max-w-2xl text-stone-600">Stock by grade, with every balance traceable to recorded movements and grading batches.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild><Link href="/eggs/grading/new">Grade eggs</Link></Button>
          {commercial && <Button asChild variant="secondary"><Link href="/eggs/pricing">Manage prices</Link></Button>}
        </div>
      </div>
      <section className="grid gap-4 md:grid-cols-[1.15fr_2fr]">
        <Card className="relative overflow-hidden border-[#d8e8b8] bg-[#f7fbe9] p-6 shadow-sm"><ChickenBadge size={50} className="absolute right-5 top-5"/><Egg size={23} className="text-[#6eaa2e]"/><p className="mt-8 text-sm font-medium text-stone-600">Total egg stock</p><p className="mt-1 text-4xl font-bold tracking-tight text-stone-900 data-number">{total.toLocaleString()}</p><p className="mt-2 text-sm text-stone-500">Available across {inventory.length} configured grades</p></Card>
        <Card className="grid gap-px overflow-hidden bg-stone-200 p-px sm:grid-cols-3">
          <div className="bg-white p-5"><PackageCheck size={20} className="text-emerald-700"/><p className="mt-5 text-sm text-stone-500">Graded stock</p><p className="mt-1 text-2xl font-bold data-number">{(total - inventory.filter((grade) => grade.is_unsorted).reduce((sum, grade) => sum + Number(grade.total_eggs), 0)).toLocaleString()}</p></div>
          <div className="bg-white p-5"><Tags size={20} className="text-amber-700"/><p className="mt-5 text-sm text-stone-500">Awaiting grading</p><p className="mt-1 text-2xl font-bold data-number">{inventory.filter((grade) => grade.is_unsorted).reduce((sum, grade) => sum + Number(grade.total_eggs), 0).toLocaleString()}</p></div>
          <div className="bg-white p-5"><Egg size={20} className="text-sky-700"/><p className="mt-5 text-sm text-stone-500">Crate capacity</p><p className="mt-1 text-2xl font-bold data-number">{context.farm.crate_size ?? 30}</p><p className="text-xs text-stone-500">eggs per crate</p></div>
        </Card>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {inventory.map((grade) => {
          const price = prices.find((item) => item.egg_grade_id === grade.egg_grade_id);
          return <Card key={grade.egg_grade_id} className="p-5 transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{grade.grade_name}</h2>{grade.is_unsorted && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">Awaiting grading</span>}</div><p className="mt-5 text-3xl font-bold tracking-tight data-number">{Number(grade.total_eggs).toLocaleString()}</p><p className="mt-1 text-sm text-stone-500">{grade.full_crates} crates + {grade.loose_eggs} loose eggs</p>{commercial && !grade.is_unsorted && <div className="mt-5 border-t border-stone-100 pt-3 text-sm leading-6 text-stone-600">Crate <strong className="text-stone-900">{price?.crate_price == null ? "—" : money(price.crate_price, context.farm.currency)}</strong><br/>Loose <strong className="text-stone-900">{price?.loose_egg_price == null ? "—" : money(price.loose_egg_price, context.farm.currency)}</strong></div>}</Card>;
        })}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Recent grade movements</h2></div>{moves.map((movement) => <div key={movement.id} className="grid grid-cols-[1fr_auto] border-b p-4"><div><p className="font-medium">{movement.egg_grades?.name} · {movement.movement_type.replaceAll("_", " ")}</p><p className="text-sm text-stone-500">{formatFarmDate(movement.movement_date)}</p></div><p className={`font-semibold ${movement.direction === "IN" ? "text-emerald-700" : "text-red-700"}`}>{movement.direction === "IN" ? "+" : "−"}{movement.quantity_eggs}</p></div>)}</Card>
        <Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-5"><h2 className="font-semibold">Grading history</h2><Link href="/eggs/grading/new" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800">Grade eggs <ArrowUpRight size={15}/></Link></div>{batches.map((batch) => { const outputs = (allocations ?? []).filter((item) => item.grading_batch_id === batch.id); return <div key={batch.id} className="border-b p-4"><div className="flex justify-between"><p className="font-medium">{batch.input_quantity_eggs} Unsorted graded</p><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium capitalize">{batch.status}</span></div><p className="text-sm text-stone-500">{formatFarmDate(batch.grading_date)}</p><p className="mt-2 text-sm">{outputs.map((output) => `${gradeNames.get(output.target_grade_id) ?? "Unknown"}: ${output.quantity_eggs}`).join(" · ")}</p></div>; })}{!batches.length && <p className="p-8 text-center text-stone-500">No grading batches yet.</p>}</Card>
      </div>
    </div>
  );
}
