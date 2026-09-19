import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { money } from "@/lib/reporting";
import { Card } from "@/components/ui/card";
import { PaymentForm } from "@/components/forms/payment-form";
import { BirdSaleVoidButton } from "@/components/forms/bird-sale-void-button";
import { CreditTermsForm } from "@/components/forms/credit-terms-form";

export default async function Sale({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: sale }, { data: receivable }, { data: collection }, { data: items }, { data: payments }, { data: bird }, { data: audit }] = await Promise.all([
    supabase.from("sales").select("*,customers(name)").eq("id", id).maybeSingle(),
    supabase.from("v_sales_receivables").select("*").eq("sale_id", id).maybeSingle(),
    supabase.from("v_credit_collections").select("collection_status").eq("sale_id", id).maybeSingle(),
    supabase.from("sale_items").select("*").eq("sale_id", id),
    supabase.from("customer_payments").select("*").eq("sale_id", id).order("payment_date", { ascending: false }),
    supabase.from("bird_sale_details").select("*,flocks(flock_name)").eq("sale_id", id).maybeSingle(),
    context.membership.role === "admin" ? supabase.from("audit_logs").select("event_time,action,summary,metadata,profiles(email)").eq("entity_type", "sales").eq("entity_id", id).order("event_time", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  if (!sale || !receivable) notFound();
  const customer = Array.isArray(sale.customers) ? sale.customers[0] : sale.customers;
  const isBird = (sale as { sale_type?: string }).sale_type === "bird";

  return <div className="space-y-7">
    <div className="flex flex-wrap justify-between gap-4"><div><p className="text-sm font-semibold text-[#527c22]">{sale.sale_number} · {isBird ? "Bird Sale" : "Egg Sale"}</p><h1 className="mt-1 text-3xl font-bold">{customer?.name || "Walk-in customer"}</h1><p className="mt-1 text-sm text-stone-500">Created {new Date(sale.created_at).toLocaleString()}</p></div><Link href="/sales" className="rounded-xl border bg-white px-4 py-3 text-sm font-semibold">All sales</Link></div>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Sale total", money(receivable.total_amount, context.farm.currency)], ["Amount paid", money(receivable.total_paid, context.farm.currency)], ["Outstanding", money(receivable.outstanding_balance, context.farm.currency)], ["Payment status", receivable.payment_status]].map(([label, value]) => <Card key={label} className="p-5"><p className="text-xs text-stone-500">{label}</p><p className="mt-2 text-xl font-bold capitalize">{value}</p></Card>)}</section>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-6"><h2 className="font-semibold">{isBird ? "Bird sale details" : "Sale items"}</h2>{isBird && bird ? <div className="mt-4 space-y-3"><p><b>Flock:</b> {bird.flocks?.flock_name}</p><p><b>Category:</b> {bird.category.replaceAll("_", " ")}</p><p><b>Quantity:</b> {bird.quantity} birds</p><p><b>Price per bird:</b> {money(bird.price_per_bird, context.farm.currency)}</p><p><b>Population movement:</b> {bird.bird_movement_id}</p>{sale.status === "completed" && context.membership.role === "admin" && <BirdSaleVoidButton saleId={id}/>}</div> : null}{!isBird && items?.map((item) => <div key={item.id} className="mt-4 flex justify-between"><span className="capitalize">{item.quantity} {item.item_type.replace("_", " ")}</span><span>{money(item.line_total, context.farm.currency)}</span></div>)}</Card>
      {sale.status === "completed" && Number(receivable.outstanding_balance) > 0 && <Card className="p-6"><h2 className="font-semibold">Record payment</h2><div className="mt-4"><PaymentForm saleId={id} today={farmToday(context.farm.timezone)} balance={Number(receivable.outstanding_balance)}/></div></Card>}
    </div>
    {sale.customer_id && <Card className="p-6"><h2 className="font-semibold">Payment terms</h2><p className="mt-2 text-sm capitalize text-stone-600">{collection?.collection_status?.replaceAll("_", " ") ?? "Unscheduled"}{sale.payment_due_date ? ` · Due ${sale.payment_due_date}` : ""}</p>{sale.status === "completed" && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-[#527c22]">Update credit terms</summary><CreditTermsForm saleId={id} saleDate={sale.sale_date} creditDays={sale.credit_days} dueDate={sale.payment_due_date}/></details>}</Card>}
    <Card className="overflow-hidden"><div className="border-b p-5 font-semibold">Payments</div>{payments?.map((payment) => <div key={payment.id} className="grid grid-cols-3 p-5"><span>{payment.payment_date}</span><span>{money(payment.amount, context.farm.currency)}</span><span>{payment.voided_at ? "Voided" : payment.payment_method}</span></div>)}{!payments?.length && <p className="p-5 text-sm text-stone-500">No payment has been recorded for this sale.</p>}</Card>
    {context.membership.role === "admin" && <Card className="overflow-hidden"><div className="border-b p-5 font-semibold">Audit history</div>{audit?.map((event, index) => { const actor = Array.isArray(event.profiles) ? event.profiles[0] : event.profiles; return <div key={`${event.event_time}-${index}`} className="border-b p-5"><p className="font-medium">{event.summary}</p><p className="mt-1 text-sm text-stone-500">{event.action.replaceAll("_", " ")} · {new Date(event.event_time).toLocaleString()}{actor?.email ? ` · ${actor.email}` : ""}</p></div> })}{!audit?.length && <p className="p-5 text-sm text-stone-500">No audit events are available for this sale.</p>}</Card>}
  </div>;
}
