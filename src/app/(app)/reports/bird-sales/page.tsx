import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange, money } from "@/lib/reporting";
import { DateFilter, Kpis, ReportTable } from "@/components/reports/report-ui";

export default async function BirdSalesReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireRole(["admin", "manager"]);
  const query = await searchParams;
  const range = reportRange(context.farm.timezone, query);
  const supabase = await createClient();
  let birdQuery = supabase
    .from("bird_sale_details")
    .select("*,sales!inner(sale_number,sale_date,total_amount,status,customer_id,customers(name)),flocks(flock_name)")
    .eq("farm_id", context.farm.id)
    .eq("sales.status", "completed")
    .gte("sales.sale_date", range.from)
    .lte("sales.sale_date", range.to);
  if (query.flock) birdQuery = birdQuery.eq("flock_id", query.flock);
  if (query.category) birdQuery = birdQuery.eq("category", query.category);
  if (query.customer) birdQuery = birdQuery.eq("sales.customer_id", query.customer);
  const [{ data: rawRows }, { data: receivables }, { data: payments }, { data: flocks }, { data: customers }] = await Promise.all([
    birdQuery,
    supabase.from("v_sales_receivables").select("sale_id,payment_status,total_paid,outstanding_balance").eq("farm_id", context.farm.id).gte("sale_date", range.from).lte("sale_date", range.to),
    supabase.from("customer_payments").select("amount,sales!inner(sale_type)").eq("farm_id", context.farm.id).is("voided_at", null).gte("payment_date", range.from).lte("payment_date", range.to).eq("sales.sale_type", "bird"),
    supabase.from("flocks").select("id,flock_name").eq("farm_id", context.farm.id).order("flock_name"),
    supabase.from("customers").select("id,name").eq("farm_id", context.farm.id).eq("active", true).order("name"),
  ]);
  const receivableBySale = new Map((receivables ?? []).map((row) => [row.sale_id, row]));
  const rows = (rawRows ?? []).filter((row) => !query.payment || receivableBySale.get(row.sale_id)?.payment_status === query.payment);
  const birds = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
  const revenue = rows.reduce((sum, row) => sum + Number(row.line_total), 0);
  const outstanding = rows.reduce((sum, row) => sum + Number(receivableBySale.get(row.sale_id)?.outstanding_balance ?? 0), 0);
  const cashCollected = (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const byFlock = new Map<string, { birds: number; revenue: number }>();
  const byCategory = new Map<string, { birds: number; revenue: number }>();
  for (const row of rows) {
    const flockName = Array.isArray(row.flocks) ? row.flocks[0]?.flock_name : row.flocks?.flock_name;
    const flock = byFlock.get(flockName ?? "Unknown flock") ?? { birds: 0, revenue: 0 };
    flock.birds += Number(row.quantity); flock.revenue += Number(row.line_total); byFlock.set(flockName ?? "Unknown flock", flock);
    const category = row.category.replaceAll("_", " "); const group = byCategory.get(category) ?? { birds: 0, revenue: 0 };
    group.birds += Number(row.quantity); group.revenue += Number(row.line_total); byCategory.set(category, group);
  }

  return <div>
    <h1 className="text-3xl font-bold">Bird sales report</h1><p className="mt-2 text-stone-600">Direct flock sales only. Bird sale revenue is included without inventing a bird cost of sales.</p>
    <DateFilter from={range.from} to={range.to} exportType="bird-sales">
      <label>Flock<select name="flock" defaultValue={query.flock ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All flocks</option>{flocks?.map((flock) => <option key={flock.id} value={flock.id}>{flock.flock_name}</option>)}</select></label>
      <label>Category<select name="category" defaultValue={query.category ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All categories</option><option value="live_bird">Live Bird</option><option value="spent_layer">Spent Layer</option><option value="cull_bird">Cull Bird</option></select></label>
      <label>Customer<select name="customer" defaultValue={query.customer ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All customers</option>{customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
      <label>Payment status<select name="payment" defaultValue={query.payment ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All payment states</option><option value="unpaid">Unpaid</option><option value="partial">Partially paid</option><option value="paid">Paid</option></select></label>
    </DateFilter>
    <Kpis items={[["Bird sales", rows.length], ["Birds sold", birds], ["Revenue", money(revenue, context.farm.currency)], ["Average price / bird", money(birds ? revenue / birds : 0, context.farm.currency)], ["Cash collected", money(cashCollected, context.farm.currency)], ["Outstanding", money(outstanding, context.farm.currency)]]}/>
    <div className="mt-6 grid gap-6 xl:grid-cols-2"><div><h2 className="text-lg font-semibold">Sales by flock</h2><ReportTable headers={["Flock", "Birds sold", "Revenue"]} rows={[...byFlock.entries()].map(([flock, totals]) => [flock, totals.birds, money(totals.revenue, context.farm.currency)])} empty="No flock sales in this period."/></div><div><h2 className="text-lg font-semibold">Sales by category</h2><ReportTable headers={["Category", "Birds sold", "Revenue"]} rows={[...byCategory.entries()].map(([category, totals]) => [category, totals.birds, money(totals.revenue, context.farm.currency)])} empty="No Bird Sales in this period."/></div></div>
    <ReportTable headers={["Date", "Reference", "Customer", "Flock", "Category", "Birds", "Price / bird", "Revenue", "Payment"]} rows={rows.map((row) => { const sale = Array.isArray(row.sales) ? row.sales[0] : row.sales; const customer = Array.isArray(sale?.customers) ? sale.customers[0] : sale?.customers; return [sale?.sale_date, sale?.sale_number, customer?.name ?? "Walk-in", row.flocks?.flock_name, row.category.replaceAll("_", " "), row.quantity, money(row.price_per_bird, context.farm.currency), money(row.line_total, context.farm.currency), receivableBySale.get(row.sale_id)?.payment_status ?? "—"]; })} empty="No Bird Sales match this report."/>
  </div>;
}
