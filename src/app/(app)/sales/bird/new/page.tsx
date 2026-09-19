import Link from "next/link";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { BirdSaleForm } from "@/components/forms/bird-sale-form";

export default async function NewBirdSale() {
  const context = await requireRole(["admin", "manager"]); const supabase = await createClient();
  const [{ data: customers }, { data: flocks }] = await Promise.all([supabase.from("customers").select("id,name,default_credit_days").eq("farm_id", context.farm.id).eq("active", true).order("name"), supabase.from("v_current_flock_status").select("flock_id,flock_name,current_live_birds").eq("farm_id", context.farm.id).eq("status", "active").gt("current_live_birds", 0).order("flock_name")]);
  const flockRows = (flocks ?? []).map((flock) => ({ id: flock.flock_id, name: flock.flock_name, live: Number(flock.current_live_birds), age: "Live population" }));
  return <div><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Sales & customers</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Record Bird Sale</h1><p className="mt-2 max-w-2xl text-stone-600">Sell live birds, spent layers, or cull birds directly from a flock. The population movement and commercial sale are posted together.</p></div><Link href="/sales/new" className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold">Record egg sale</Link></div><Card className="mt-7 p-5 sm:p-7">{customers?.length && flockRows.length ? <BirdSaleForm customers={customers} flocks={flockRows} today={farmToday(context.farm.timezone)} currency={context.farm.currency}/> : <div className="p-6 text-center"><h2 className="font-bold">A customer and an active flock are required</h2><p className="mt-2 text-sm text-stone-600">Create an active customer and ensure the flock has live birds before recording a Bird Sale.</p></div>}</Card></div>;
}
