import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange, money } from "@/lib/reporting";
import { DateFilter, Kpis } from "@/components/reports/report-ui";
import { ReportTable } from "@/components/reports/report-table";

export default async function ExpenseReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireRole(["admin", "manager"]);
  const query = await searchParams;
  const range = reportRange(context.farm.timezone, query);
  const supabase = await createClient();
  const category = query.category || null;
  const source = query.source || null;
  const [{ data: summary }, { data: rows }, { data: categories }] = await Promise.all([
    supabase.rpc("get_expense_report_summary", { start_date: range.from, end_date: range.to, target_category: category, target_source: source }),
    supabase.from("v_expense_payables").select("*").eq("farm_id", context.farm.id).gte("expense_date", range.from).lte("expense_date", range.to).order("expense_date", { ascending: false }),
    supabase.from("expense_categories").select("id,name").eq("farm_id", context.farm.id),
  ]);
  const totals = summary?.[0] ?? {};
  const filtered = (rows ?? []).filter((row) => (!category || row.category_id === category) && (!source || row.source_type === source));

  return <div>
    <h1 className="text-3xl font-bold">Expense and payables report</h1>
    <p className="mt-2 text-stone-600">Expenses incurred are separate from cash paid.</p>
    <DateFilter from={range.from} to={range.to} exportType="expenses">
      <label className="text-sm font-medium">Category<select name="category" defaultValue={category ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All categories</option>{categories?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm font-medium">Source<select name="source" defaultValue={source ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All sources</option><option value="manual">Manual</option><option value="health_record">Health record</option><option value="daily_production">Daily production</option></select></label>
    </DateFilter>
    <Kpis items={[["Expenses incurred", money(totals.expenses_incurred, context.farm.currency)], ["Amount paid as of period end", money(totals.amount_paid, context.farm.currency)], ["Outstanding payables", money(totals.outstanding_payables, context.farm.currency)], ["Expense count", Number(totals.expense_count ?? 0)]]} />
    <ReportTable headers={["Date", "Expense", "Category", "Description", "Source", "Amount", "Paid", "Outstanding", "Status"]} rows={filtered.map((row) => [row.expense_date, row.expense_number, row.category_name, row.description, row.source_type, money(row.amount, context.farm.currency), money(row.total_paid, context.farm.currency), money(row.outstanding_balance, context.farm.currency), row.payment_status])} empty="No expenses recorded for this period." />
  </div>;
}
