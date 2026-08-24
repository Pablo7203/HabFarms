import Link from "next/link";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange, money } from "@/lib/reporting";
import { DateFilter, Kpis, ReportTable } from "@/components/reports/report-ui";
import { CashVoidButton } from "@/components/forms/cash-adjustment-form";
import { Pagination, pageWindow } from "@/components/ui/pagination";

export default async function CashFlow({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireRole(["admin", "manager"]), query = await searchParams, range = reportRange(context.farm.timezone, query), supabase = await createClient(), window = pageWindow(query.page);
  let ledgerQuery = supabase.from("v_cash_ledger").select("*").eq("farm_id", context.farm.id).gte("transaction_date", range.from).lte("transaction_date", range.to).order("transaction_date").order("created_at").range(0,window.to+1);
  if (query.method) ledgerQuery = ledgerQuery.eq("payment_method", query.method);
  const summaryQuery = query.method
    ? supabase.rpc("get_cash_flow_summary_filtered", { start_date: range.from, end_date: range.to, target_payment_method: query.method })
    : supabase.rpc("get_cash_flow_summary", { start_date: range.from, end_date: range.to });
  const [{ data: summary }, { data: ledger }] = await Promise.all([summaryQuery, ledgerQuery]);
  const totals = summary?.[0], opening = Number(totals?.opening_balance ?? 0), entries = ledger ?? [];
  const rows = entries.map((item,index) => { const running=opening+entries.slice(0,index+1).reduce((balance,entry)=>balance+(entry.direction==="IN"?Number(entry.amount):-Number(entry.amount)),0); return [item.transaction_date, item.description, item.source_type.replaceAll("_", " "), item.payment_method, item.direction === "IN" ? money(item.amount, context.farm.currency) : "—", item.direction === "OUT" ? money(item.amount, context.farm.currency) : "—", money(running, context.farm.currency), context.membership.role === "admin" && item.source_type === "cash_adjustment" ? <CashVoidButton id={item.transaction_id} /> : null]; }).slice(window.from,window.to+1);
  return <div><div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-bold">Cash flow</h1><p className="mt-2 text-stone-600">Tracked from opening cash and recorded payments. This is not bank reconciliation.</p></div>{context.membership.role === "admin" && <Link href="/cash-flow/adjustments/new" className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">New cash adjustment</Link>}</div><DateFilter from={range.from} to={range.to} exportType="cash-flow"><label className="text-sm font-medium">Payment method<select name="method" defaultValue={query.method ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All methods</option><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label></DateFilter><Kpis items={[["Opening balance", money(totals?.opening_balance, context.farm.currency)], ["Total inflows", money(totals?.total_inflows, context.farm.currency)], ["Total outflows", money(totals?.total_outflows, context.farm.currency)], ["Net cash movement", money(totals?.net_movement, context.farm.currency)], ["Tracked closing balance", money(totals?.closing_balance, context.farm.currency), "Based on transactions recorded in this system"]]} /><ReportTable headers={["Date", "Description", "Source", "Method", "Inflow", "Outflow", "Running balance", "Action"]} rows={rows} empty="No cash transactions recorded for this period." /><Pagination page={window.page} hasMore={(ledger?.length??0)>window.to+1} base="/cash-flow" params={query}/></div>;
}
