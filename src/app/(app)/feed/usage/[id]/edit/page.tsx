import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { FlockFeedConsumptionForm } from "@/components/forms/flock-feed-consumption-form";

export default async function EditFlockFeedConsumption({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireAppContext();
  if (context.membership.role !== "admin" && context.membership.role !== "manager") redirect("/feed/usage");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: record }, { data: feedTypes }] = await Promise.all([
    supabase.from("flock_feed_consumptions").select("id,feed_type_id,quantity_kg,notes,consumption_date,flock_id").eq("id", id).eq("farm_id", context.farm.id).maybeSingle(),
    supabase.from("feed_types").select("id,name").eq("farm_id", context.farm.id).eq("active", true).order("name"),
  ]);
  if (!record) notFound();
  const { data: flock } = await supabase.from("flocks").select("flock_name").eq("id", record.flock_id).eq("farm_id", context.farm.id).single();
  return <div className="mx-auto max-w-2xl"><Link href="/feed/usage" className="text-sm font-semibold text-emerald-800">← Feed use history</Link><h1 className="mt-4 text-3xl font-bold">Correct feed-use entry</h1><p className="mt-2 text-stone-600">{flock?.flock_name} · {record.consumption_date}</p><Card className="mt-6 p-5 sm:p-7"><FlockFeedConsumptionForm flocks={[]} feedTypes={feedTypes ?? []} today={record.consumption_date} canBackdate record={{ id: record.id, feedTypeId: record.feed_type_id, quantityKg: Number(record.quantity_kg), notes: record.notes }}/></Card></div>;
}
