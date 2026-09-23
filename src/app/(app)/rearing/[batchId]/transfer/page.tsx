import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleAlert } from "lucide-react";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { RearingTransferForm } from "@/components/forms/rearing-transfer-form";

export const metadata = { title: "Transfer pullets" };

export default async function NewRearingTransfer({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params, context = await requireRole(["admin", "manager"]), supabase = await createClient();
  const [{ data: batch }, { data: flockRows }] = await Promise.all([
    supabase.from("v_rearing_population").select("batch_id,farm_id,batch_code,breed_or_strain,supplier_id,arrival_date,hatch_date,stage,status,current_birds").eq("batch_id",batchId).eq("farm_id",context.farm.id).maybeSingle(),
    supabase.from("flocks").select("id,flock_name,batch_reference,breed,house_pen,start_date,status").eq("farm_id",context.farm.id).eq("status","active").order("flock_name"),
  ]);
  if (!batch) notFound();
  const today = farmToday(context.farm.timezone);
  if (batch.status === "transferred" || batch.status === "closed" || Number(batch.current_birds) <= 0 || batch.stage !== "ready_for_transfer") {
    const reason = batch.stage !== "ready_for_transfer" ? "Mark this batch Ready for Transfer first." : Number(batch.current_birds)<=0 ? "No surviving birds are available to transfer." : "This batch is closed to transfers.";
    return <div className="mx-auto max-w-3xl pb-8"><Link href={`/rearing/${batchId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800"><ArrowLeft size={16}/>Back to batch</Link><Card className="mt-5 p-6"><CircleAlert className="text-amber-700"/><h1 className="mt-3 text-2xl font-bold">Transfer not available</h1><p className="mt-2 text-stone-600">{reason}</p></Card></div>;
  }
  const [{ data: previewRows }, { data: populationRows }] = await Promise.all([
    supabase.rpc("get_rearing_transfer_preview", { target_batch: batchId, target_date: today }),
    supabase.from("v_current_flock_status").select("flock_id,current_live_birds").eq("farm_id",context.farm.id),
  ]);
  const preview = Array.isArray(previewRows) ? previewRows[0] : previewRows;
  const population = new Map((populationRows??[]).map((row:{flock_id:string;current_live_birds:number})=>[row.flock_id,Number(row.current_live_birds)]));
  const flocks = (flockRows??[]).filter(f=>f.start_date<=today).map(f=>({ ...f, current_live_birds:population.get(f.id)??0 }));
  return <div className="mx-auto max-w-4xl pb-10">
    <Link href={`/rearing/${batchId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800"><ArrowLeft size={16}/>Back to {batch.batch_code}</Link>
    <header className="mt-4"><p className="text-sm font-semibold text-emerald-800">Point-of-lay transfer</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Move pullets into layer operations</h1><p className="mt-2 max-w-2xl text-stone-600">The batch and flock populations update together. This does not create a purchase, expense, supplier balance, or cash entry.</p></header>
    <Card className="mt-6 p-4 sm:p-7">
      {preview ? <RearingTransferForm batchId={batchId} batchCode={batch.batch_code} breed={batch.breed_or_strain} arrivalDate={batch.arrival_date} today={today} currentBirds={Number(preview.available_birds)} remainingCost={Number(preview.remaining_cost)} costComplete={Boolean(preview.cost_complete)} currency={context.farm.currency} flocks={flocks}/> : <p className="text-sm text-red-800">Could not load the source population and cost preview.</p>}
    </Card>
    <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-stone-500"><ArrowRight size={14} className="mt-0.5 shrink-0"/>Transfer confirmation revalidates the latest bird balance, cost basis, farm access, and destination on the server.</div>
  </div>;
}
