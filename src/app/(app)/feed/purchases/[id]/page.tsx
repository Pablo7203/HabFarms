import{money}from"@/lib/format";import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { FeedPaymentForm } from "@/components/forms/feed-forms";
import { Card } from "@/components/ui/card";

export default async function Purchase({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: purchase }, { data: payments }, { data: movements }] = await Promise.all([
    supabase.from("v_feed_purchase_receivables").select("*").eq("id", id).maybeSingle(),
    supabase.from("feed_purchase_payments").select("*").eq("feed_purchase_id", id).order("payment_date", { ascending: false }),
    supabase.from("feed_inventory_movements").select("*").eq("source_id", id).order("created_at"),
  ]);

  if (!purchase) notFound();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm text-emerald-700">{purchase.purchase_number}</p><h1 className="text-3xl font-bold">Feed purchase</h1></div>
        <Link href={`/feed/purchases/${id}/edit`} className="rounded-lg border bg-white px-4 py-3 text-sm font-semibold">Edit purchase</Link>
      </div>
      <div className="mt-7 grid gap-4 sm:grid-cols-4">
        {[["Total kg", purchase.total_kg], ["Total", money(purchase.total_cost,context.farm.currency)], ["Paid", money(purchase.total_paid,context.farm.currency)], ["Outstanding", money(purchase.outstanding_balance,context.farm.currency)]].map(([label, value]) => <Card key={label} className="p-5"><p className="text-xs text-stone-500">{label}</p><b className="mt-2 block text-xl">{value}</b></Card>)}
      </div>
      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <Card className="p-6"><h2 className="font-semibold">Purchase snapshot</h2><p className="mt-4">{purchase.bags} bags × {purchase.bag_size_kg} kg</p><p>{money(purchase.cost_per_bag,context.farm.currency)}/bag · {money(purchase.cost_per_kg,context.farm.currency)}/kg</p><p className="capitalize">Status: {purchase.status}</p></Card>
        <Card className="p-6"><h2 className="font-semibold">Inventory movements</h2>{movements?.map((movement) => <p key={movement.id} className="mt-3">{movement.direction} {movement.quantity_kg} kg · {movement.movement_type}</p>)}</Card>
      </div>
      {Number(purchase.outstanding_balance) > 0 && <Card className="mt-7 p-6"><h2 className="mb-4 font-semibold">Record supplier payment</h2><FeedPaymentForm id={id} today={farmToday(context.farm.timezone)}/></Card>}
      <Card className="mt-7 divide-y"><h2 className="p-5 font-semibold">Payment history</h2>{payments?.map((payment) => <div key={payment.id} className="grid grid-cols-3 p-5"><span>{payment.payment_date}</span><span>{money(payment.amount,context.farm.currency)}</span><span>{payment.voided_at ? "Voided" : payment.payment_method}</span></div>)}</Card>
    </div>
  );
}
