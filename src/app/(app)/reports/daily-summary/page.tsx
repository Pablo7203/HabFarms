import Link from "next/link";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { money } from "@/lib/format";
import { GradeBreakdown, number, records, SummaryCard, type JsonRecord } from "@/components/reports/farm-summary";

export default async function DailySummary({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireAppContext(); const query = await searchParams; const date = query.date ?? farmToday(context.farm.timezone); const flock = query.flock ?? ""; const supabase = await createClient();
  const [{ data }, { data: flocks }, { data: plan }, { data: henDayTarget }] = await Promise.all([
    supabase.rpc("get_daily_farm_summary", { summary_date: date, target_flock: flock || null }),
    supabase.from("flocks").select("id,flock_name").eq("farm_id", context.farm.id).order("flock_name"),
    supabase.rpc("get_feed_plan_summary", { start_date: date, end_date: date, target_flock: flock || null }),
    supabase.rpc("get_hen_day_target_summary", { start_date: date, end_date: date, target_flock: flock || null }),
  ]);
  const summary = (Array.isArray(data) ? data[0] : data) as JsonRecord | null;
  const production = (summary?.production ?? {}) as JsonRecord; const birds = (summary?.birds ?? {}) as JsonRecord; const feed = (summary?.feed ?? {}) as JsonRecord;
  const feedPlan = (Array.isArray(plan) ? plan[0] : plan) as JsonRecord | null; const commercial = (summary?.commercial ?? {}) as JsonRecord; const financial = summary?.financial_access === true;
  const henTarget = (Array.isArray(henDayTarget) ? henDayTarget[0] : henDayTarget) as JsonRecord | null;
  let birdSales: { quantity: number | string; line_total: number | string }[] = [];
  let birdSalePayments: { amount: number | string }[] = [];
  if (financial) {
    let birdQuery = supabase.from("bird_sale_details").select("quantity,line_total,sales!inner(sale_date,status)").eq("farm_id", context.farm.id).eq("sales.status", "completed").eq("sales.sale_date", date);
    if (flock) birdQuery = birdQuery.eq("flock_id", flock);
    let birdPaymentQuery = supabase.from("customer_payments").select("amount,sales!inner(sale_type,bird_sale_details!inner(flock_id))").eq("farm_id", context.farm.id).is("voided_at", null).eq("payment_date", date).eq("sales.sale_type", "bird");
    if (flock) birdPaymentQuery = birdPaymentQuery.eq("sales.bird_sale_details.flock_id", flock);
    const [{ data: rawBirdSales }, { data: rawBirdPayments }] = await Promise.all([
      birdQuery,
      birdPaymentQuery,
    ]);
    birdSales = rawBirdSales ?? [];
    birdSalePayments = rawBirdPayments ?? [];
  }
  const birdsSold = birdSales.reduce((sum, row) => sum + Number(row.quantity), 0); const birdRevenue = birdSales.reduce((sum, row) => sum + Number(row.line_total), 0); const birdCash = birdSalePayments.reduce((sum, row) => sum + Number(row.amount), 0);
  const source = (path: string) => `${path}?from=${date}&to=${date}${flock ? `&flock=${flock}` : ""}`;
  return <div>
    <div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-bold">Daily farm summary</h1><p className="mt-2 text-stone-600">What happened on the farm on this date. Every metric links to source records.</p></div><Link href="/reports" className="rounded-lg border bg-white px-4 py-3 text-sm font-semibold">All reports</Link></div>
    <form className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-3"><label className="text-sm font-medium">Date<input className="mt-2 min-h-11 w-full rounded-lg border px-3" type="date" name="date" defaultValue={date}/></label><label className="text-sm font-medium">Flock<select className="mt-2 min-h-11 w-full rounded-lg border px-3" name="flock" defaultValue={flock}><option value="">All flocks</option>{(flocks ?? []).map((item) => <option key={item.id} value={item.id}>{item.flock_name}</option>)}</select></label><button className="min-h-11 self-end rounded-lg border px-4 text-sm font-semibold">Apply</button></form>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Eligible birds" value={number(birds.opening_eligible_birds)} href="/flocks"/><SummaryCard label="Deaths" value={number(birds.deaths)} href="/flocks"/><SummaryCard label="Eggs collected" value={number(production.eggs_collected)} href={source("/reports/production")}/><SummaryCard label="Hen-Day production" value={production.hen_day_percentage == null ? "Not available" : `${number(production.hen_day_percentage).toFixed(2)}%`} href={source("/reports/production")}/></div>
    <h2 className="mt-6 text-xl font-semibold">Hen-Day performance</h2><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Actual" value={henTarget?.actual_hen_day_percentage == null ? "Not available" : `${number(henTarget.actual_hen_day_percentage).toFixed(2)}%`} href={source("/reports/production")}/><SummaryCard label="Target" value={henTarget?.target_hen_day_percentage == null ? "Not configured" : `${number(henTarget.target_hen_day_percentage).toFixed(2)}%`} href={flock ? `/flocks/${flock}` : "/flocks"}/><SummaryCard label="Variance" value={henTarget?.variance_points == null ? "Not available" : `${number(henTarget.variance_points) >= 0 ? "+" : ""}${number(henTarget.variance_points).toFixed(2)} pts`} detail={henTarget?.status === "below_target" ? "Below configured target" : "At or above configured target"} href={source("/reports/production")}/><SummaryCard label="Target coverage" value={`${number(henTarget?.target_coverage_percentage).toFixed(0)}%`} detail="Eligible bird-days with a target" href="/flocks"/></div>
    <GradeBreakdown title="Production allocation by grade" rows={records(production.grade_allocation)} currency={context.farm.currency}/><GradeBreakdown title="Inventory at end of day" rows={records(summary?.inventory)} currency={context.farm.currency}/>
    <h2 className="mt-6 text-xl font-semibold">Feed planning</h2><div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Feed target" value={feedPlan?.configured === true ? `${number(feedPlan.target_kg).toFixed(3)} kg` : "Not configured"} href="/feed/planning"/><SummaryCard label="Actual feed" value={`${number(feedPlan?.actual_kg).toFixed(3)} kg`} href={source("/reports/feed")}/><SummaryCard label="Variance" value={feedPlan?.configured === true ? `${number(feedPlan.variance_kg) >= 0 ? "+" : ""}${number(feedPlan.variance_kg).toFixed(3)} kg` : "Not available"} detail={feedPlan?.variance_percentage == null ? "Configure a plan to compare." : `${number(feedPlan.variance_percentage) >= 0 ? "+" : ""}${number(feedPlan.variance_percentage).toFixed(2)}% versus plan`} href="/feed/planning"/><SummaryCard label="Feed consumed" value={`${number(feed.consumed_kg).toFixed(3)} kg`} href={source("/reports/feed")}/></div>
    {financial && <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><SummaryCard label="Sales revenue" value={money(number(commercial.sales_revenue), context.farm.currency)} href={source("/reports/sales")}/><SummaryCard label="Birds sold" value={birdsSold} href={source("/reports/bird-sales")}/><SummaryCard label="Bird sale revenue" value={money(birdRevenue, context.farm.currency)} href={source("/reports/bird-sales")}/><SummaryCard label="Bird sale cash collected" value={money(birdCash, context.farm.currency)} href={source("/cash-flow")}/><SummaryCard label="Cash collected" value={money(number(commercial.cash_collected), context.farm.currency)} href={source("/cash-flow")}/><SummaryCard label="Operating result" value={money(Math.abs(number(commercial.operating_result)), context.farm.currency)} href={source("/reports/profitability")}/></div>}
  </div>;
}
