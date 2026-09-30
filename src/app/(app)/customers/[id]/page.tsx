import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/reporting";
import { Card } from "@/components/ui/card";

const label = (row: { collection_status: string; days_overdue: number; days_until_due: number }) => row.collection_status === "overdue"
  ? `${row.days_overdue} Days Overdue`
  : row.collection_status === "due_today"
    ? "Due Today"
    : row.collection_status === "upcoming"
      ? `Due in ${row.days_until_due} Days`
      : "Unscheduled Credit";

export default async function Customer({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: customer }, { data: balance }, { data: openSales }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase.from("v_customer_balances").select("*").eq("customer_id", id).maybeSingle(),
    supabase.from("v_credit_collections").select("*").eq("customer_id", id).gt("outstanding_balance", 0).order("payment_due_date", { ascending: true, nullsFirst: false }),
  ]);
  if (!customer) notFound();
  const totalFor = (status: string) => openSales?.filter((sale) => sale.collection_status === status).reduce((total, sale) => total + Number(sale.outstanding_balance), 0) ?? 0;
  const dueNext7 = openSales?.filter((sale) => sale.collection_status === "upcoming" && sale.days_until_due <= 7).reduce((total, sale) => total + Number(sale.outstanding_balance), 0) ?? 0;

  return <div>
    <div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-bold">{customer.name}</h1><p className="mt-2 capitalize text-stone-500">{customer.customer_type} · {customer.active ? "Active" : "Inactive"} · Default credit: {customer.default_credit_days ? `${customer.default_credit_days} days` : "None"}</p></div><Link href={`/customers/${id}/edit`} className="inline-flex min-h-11 items-center rounded-lg border bg-white px-4 py-3 text-sm font-semibold">Edit</Link></div>
    <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[["Total Outstanding", balance?.outstanding_balance ?? 0], ["Overdue", totalFor("overdue")], ["Due Today", totalFor("due_today")], ["Due Next 7 Days", dueNext7], ["Not Yet Due", totalFor("upcoming")]].map(([title, value]) => <Card key={title} className="p-5"><p className="text-sm text-stone-500">{title}</p><p className="mt-2 break-words text-xl font-bold">{money(value, context.farm.currency)}</p></Card>)}</div>
    <Card className="mt-7 divide-y"><div className="p-5 font-semibold">Open Credit Sales</div>{openSales?.map((sale) => <Link key={sale.sale_id} href={`/sales/${sale.sale_id}`} className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-6 sm:p-5"><div className="min-w-0"><p className="text-xs text-stone-500">Sale</p><strong className="break-words">{sale.sale_number}</strong></div><Metric label="Date" value={sale.sale_date}/><Metric label="Total" value={money(sale.sale_total, context.farm.currency)}/><Metric label="Paid" value={money(sale.total_paid, context.farm.currency)}/><Metric label="Outstanding" value={money(sale.outstanding_balance, context.farm.currency)}/><Metric label="Collection" value={sale.payment_due_date ? label(sale) : "Unscheduled Credit"}/></Link>)}{!openSales?.length && <p className="p-8 text-center text-stone-500">No open credit sales.</p>}</Card>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}
