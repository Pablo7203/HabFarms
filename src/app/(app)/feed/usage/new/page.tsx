import Link from "next/link";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { FlockFeedConsumptionForm } from "@/components/forms/flock-feed-consumption-form";

export default async function NewFlockFeedConsumption() {
  const context = await requireAppContext();
  const supabase = await createClient();
  const [{ data: flocks }, { data: feedTypes }] = await Promise.all([
    supabase.from("flocks").select("id,flock_name").eq("farm_id", context.farm.id).eq("status", "active").order("flock_name"),
    supabase.from("feed_types").select("id,name").eq("farm_id", context.farm.id).eq("active", true).order("name"),
  ]);
  const canBackdate = context.membership.role === "admin" || context.membership.role === "manager";
  return <div className="mx-auto max-w-2xl"><Link href="/feed/usage" className="text-sm font-semibold text-emerald-800">← Feed use history</Link><h1 className="mt-4 text-3xl font-bold">Record feed use</h1><p className="mt-2 text-stone-600">Record kilograms fed to a flock outside the daily egg-production entry, such as broiler feeding.</p><Card className="mt-6 p-5 sm:p-7">{!flocks?.length || !feedTypes?.length ? <p className="text-sm text-stone-600">You need an active flock and an active feed type before recording feed use.</p> : <FlockFeedConsumptionForm flocks={(flocks ?? []).map((f) => ({ id: f.id, name: f.flock_name }))} feedTypes={feedTypes} today={farmToday(context.farm.timezone)} canBackdate={canBackdate}/>}</Card></div>;
}
