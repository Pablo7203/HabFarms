import Link from "next/link";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/reporting";
import { Card } from "@/components/ui/card";
import { Pagination, pageWindow } from "@/components/ui/pagination";

const label = (row: { collection_status: string; days_overdue: number; days_until_due: number }) => row.collection_status === "overdue"
  ? `${row.days_overdue} Day${row.days_overdue === 1 ? "" : "s"} Overdue`
  : row.collection_status === "due_today"
    ? "Due Today"
    : row.collection_status === "upcoming"
      ? `Due in ${row.days_until_due} Day${row.days_until_due === 1 ? "" : "s"}`
      : "Unscheduled Credit";

export default async function Collections({ searchParams }: { searchParams: Promise<{ status?: string; customer?: string; from?: string; to?: string; page?: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const params = await searchParams;
  const window = pageWindow(params.page);
  const supabase = await createClient();
  let query = supabase.from("v_credit_collections").select("*").eq("farm_id", context.farm.id).gt("outstanding_balance", 0);
  if (params.status && params.status !== "urgent" && params.status !== "all") query = query.eq("collection_status", params.status);
  else if (!params.status || params.status === "urgent") query = query.in("collection_status", ["overdue", "due_today"]);
  if (params.customer) query = query.eq("customer_id", params.customer);
  if (params.from) query = query.gte("payment_due_date", params.from);
  if (params.to) query = query.lte("payment_due_date", params.to);

  const [{ data: rows }, { data: summary }, { data: customers }] = await Promise.all([
    query.order("payment_due_date", { ascending: true, nullsFirst: false }).range(window.from, window.to),
    supabase.rpc("get_collection_dashboard"),
    supabase.from("customers").select("id,name").eq("farm_id", context.farm.id).order("name"),
  ]);
  const totals = summary?.[0] ?? {};

  return <div>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">Collections</h1><p className="mt-2 text-stone-600">Current customer debts, calculated from payments and the farm-local date.</p></div></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Overdue Receivables", totals.overdue_total], ["Due Today", totals.due_today_total], ["Due in Next 7 Days", totals.upcoming_7_days_total], ["Total Outstanding", totals.total_outstanding]].map(([title, value]) => <Card key={title} className="p-5"><p className="text-sm text-stone-500">{title}</p><p className="mt-2 text-2xl font-bold">{money(value, context.farm.currency)}</p></Card>)}</div>
    <form className="mt-6 grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm">Status<select name="status" defaultValue={params.status ?? "urgent"} className="mt-1 min-h-11 w-full rounded-lg border px-3"><option value="urgent">Overdue + Due Today</option><option value="overdue">Overdue</option><option value="due_today">Due Today</option><option value="upcoming">Upcoming</option><option value="unscheduled">Unscheduled</option><option value="all">All Outstanding</option></select></label>
      <label className="text-sm">Customer<select name="customer" defaultValue={params.customer ?? ""} className="mt-1 min-h-11 w-full rounded-lg border px-3"><option value="">All customers</option>{customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
      <label className="text-sm">Due from<input name="from" type="date" defaultValue={params.from} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
      <label className="text-sm">Due to<input name="to" type="date" defaultValue={params.to} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
      <button className="min-h-11 rounded-lg border font-semibold sm:col-span-2 xl:col-span-4">Apply filters</button>
    </form>
    <div className="mt-6 space-y-3">{rows?.map((row) => <Card key={row.sale_id} className="p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
        <div className="min-w-0 sm:col-span-2 xl:col-span-1"><strong className="break-words">{row.customer_name}</strong><p className="text-sm text-stone-500">{row.sale_number} · {row.sale_date}</p></div>
        <div><p className="text-xs text-stone-500">Outstanding</p><strong>{money(row.outstanding_balance, context.farm.currency)}</strong></div>
        <div><p className="text-xs text-stone-500">Due date</p><span>{row.payment_due_date ?? "Not scheduled"}</span></div>
        <div><p className="text-xs text-stone-500">Status</p><span className="font-semibold">{label(row)}</span></div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1"><Link className="inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm" href={`/sales/${row.sale_id}`}>View sale</Link><Link className="inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm" href={`/customers/${row.customer_id}`}>View customer</Link><Link className="inline-flex min-h-10 items-center rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white" href={`/sales/${row.sale_id}#payment`}>Record payment</Link></div>
      </div>
    </Card>)}{!rows?.length && <Card className="p-8 text-center text-stone-500">No customer payments match these collection filters.</Card>}</div>
    <Pagination page={window.page} hasMore={(rows?.length ?? 0) === 50} base="/collections" params={params} />
  </div>;
}
