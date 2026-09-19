import Link from "next/link";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { money } from "@/lib/format";
import { GradeBreakdown, number, records, SummaryCard, type JsonRecord } from "@/components/reports/farm-summary";

export default async function WeeklySummary({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireAppContext(); const query = await searchParams; const anchor = query.week ?? farmToday(context.farm.timezone); const supabase = await createClient();
  const { data } = await supabase.rpc("get_weekly_farm_summary", { anchor_date: anchor }); const summary = (Array.isArray(data) ? data[0] : data) as JsonRecord | null;
  const start = String(summary?.week_start ?? anchor); const end = String(summary?.week_end ?? anchor);
  const [{ data: plan }] = await Promise.all([supabase.rpc("get_feed_plan_summary", { start_date: start, end_date: end, target_flock: null })]);
  const feedPlan = (Array.isArray(plan) ? plan[0] : plan) as JsonRecord | null; const production = (summary?.production ?? {}) as JsonRecord; const costs = (summary?.costs ?? {}) as JsonRecord; const commercial = (summary?.commercial ?? {}) as JsonRecord; const financial = summary?.financial_access === true;
  let birdRows: { sale_id: string; quantity: number | string; line_total: number | string }[] = []; let birdPayments: { amount: number | string }[] = []; let birdReceivables: { sale_id: string; outstanding_balance: number | string }[] = [];
  if (financial) {
    const [{ data: rawBirdRows }, { data: rawBirdPayments }, { data: rawReceivables }] = await Promise.all([
      supabase.from("bird_sale_details").select("sale_id,quantity,line_total,sales!inner(sale_date,status)").eq("farm_id", context.farm.id).eq("sales.status", "completed").gte("sales.sale_date", start).lte("sales.sale_date", end),
      supabase.from("customer_payments").select("amount,sales!inner(sale_type)").eq("farm_id", context.farm.id).is("voided_at", null).gte("payment_date", start).lte("payment_date", end).eq("sales.sale_type", "bird"),
      supabase.from("v_sales_receivables").select("sale_id,outstanding_balance,sale_type").eq("farm_id", context.farm.id).eq("sale_type", "bird").lte("sale_date", end),
    ]);
    birdRows = rawBirdRows ?? []; birdPayments = rawBirdPayments ?? []; birdReceivables = rawReceivables ?? [];
  }
  const birdsSold = birdRows.reduce((sum, row) => sum + Number(row.quantity), 0); const birdRevenue = birdRows.reduce((sum, row) => sum + Number(row.line_total), 0); const birdCash = birdPayments.reduce((sum, row) => sum + Number(row.amount), 0); const birdOutstanding = birdReceivables.reduce((sum, row) => sum + Number(row.outstanding_balance), 0);
  const source = (path: string) => `${path}?from=${start}&to=${end}`; const saleable = number(production.saleable_eggs); const operating = number(costs.feed_consumption_cost) + number(costs.feed_wastage_cost) + number(costs.other_operating_expenses);
  return <div>
    <div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-bold">Weekly farm summary</h1><p className="mt-2 text-stone-600">Performance and unit economics for {start} to {end}.</p></div><Link href="/reports" className="rounded-lg border bg-white px-4 py-3 text-sm font-semibold">All reports</Link></div>
    <form className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4"><label className="text-sm font-medium">Any date in week<input className="mt-2 block min-h-11 rounded-lg border px-3" type="date" name="week" defaultValue={anchor}/></label><button className="min-h-11 rounded-lg border px-4 text-sm font-semibold">Open week</button></form>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><SummaryCard label="Eggs collected" value={number(production.eggs_collected)} href={source("/reports/production")}/><SummaryCard label="Saleable eggs produced" value={saleable} href={source("/reports/production")}/><SummaryCard label="Hen-Day production" value={production.hen_day_percentage == null ? "Not available" : `${number(production.hen_day_percentage).toFixed(2)}%`} href={source("/reports/production")}/><SummaryCard label="Deaths" value={number(production.deaths)} href="/flocks"/></div>
    <h2 className="mt-6 text-xl font-semibold">Feed planning</h2><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Planned feed" value={feedPlan?.configured === true ? `${number(feedPlan.target_kg).toFixed(3)} kg` : "Not configured"} href="/feed/planning"/><SummaryCard label="Actual feed consumed" value={`${number(feedPlan?.actual_kg).toFixed(3)} kg`} href={source("/reports/feed")}/><SummaryCard label="Variance" value={feedPlan?.configured === true ? `${number(feedPlan.variance_kg) >= 0 ? "+" : ""}${number(feedPlan.variance_kg).toFixed(3)} kg` : "Not available"} detail={feedPlan?.variance_percentage == null ? "Configure a plan to compare." : `${number(feedPlan.variance_percentage) >= 0 ? "+" : ""}${number(feedPlan.variance_percentage).toFixed(2)}% versus plan`} href="/feed/planning"/><SummaryCard label="Current feed forecast" value="View feed" href="/feed"/></div>
    <GradeBreakdown title="Egg mix produced this week" rows={records(summary?.egg_mix)} currency={context.farm.currency} mix/>
    {financial && <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><SummaryCard label="Feed consumption cost" value={money(number(costs.feed_consumption_cost), context.farm.currency)} href={source("/reports/feed")}/><SummaryCard label="Operating production cost" value={money(operating, context.farm.currency)} href={source("/reports/profitability")}/><SummaryCard label="Sales revenue" value={money(number(commercial.revenue), context.farm.currency)} href={source("/reports/sales")}/><SummaryCard label="Birds sold" value={birdsSold} href={source("/reports/bird-sales")}/><SummaryCard label="Bird sale revenue" value={money(birdRevenue, context.farm.currency)} href={source("/reports/bird-sales")}/><SummaryCard label="Bird sale cash collected" value={money(birdCash, context.farm.currency)} href={source("/cash-flow")}/><SummaryCard label="Bird receivables at period end" value={money(birdOutstanding, context.farm.currency)} href={source("/reports/bird-sales")}/></div>}
  </div>;
}
