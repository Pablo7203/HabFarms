import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange, money } from "@/lib/reporting";
import { DateFilter, Kpis, ReportTable } from "@/components/reports/report-ui";
import { feedForecastBasisLabel, formatFeedRunway } from "@/lib/feed-forecast";
import { formatFarmDate } from "@/lib/farm-date";

export default async function FeedReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireRole(["admin", "manager"]);
  const query = await searchParams;
  const range = reportRange(context.farm.timezone, query);
  const supabase = await createClient();
  const type = query.type || null;
  const supplier = query.supplier || null;
  const [{ data: summary }, { data: balances }, { data: types }] = await Promise.all([
    supabase.rpc("get_feed_report_summary", { start_date: range.from, end_date: range.to, target_feed_type: type, target_supplier: supplier }),
    supabase.from("v_feed_forecast").select("*").eq("farm_id", context.farm.id),
    supabase.from("feed_types").select("id,name").eq("farm_id", context.farm.id),
  ]);
  const totals = summary?.[0] ?? {};

  return <div>
    <h1 className="text-3xl font-bold">Feed report</h1>
    <p className="mt-2 text-stone-600">Purchased, paid and consumed feed are reported separately. Current runway uses today’s demand plan, or recent actual use if no plan is configured.</p>
    <DateFilter from={range.from} to={range.to} exportType="feed"><label className="text-sm font-medium">Feed type<select name="type" defaultValue={query.type ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All feed</option>{types?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></DateFilter>
    <Kpis items={[
      ["Feed purchased", `${Number(totals.purchased_kg ?? 0).toFixed(3)} kg`],
      ["Purchase value", money(totals.purchase_value, context.farm.currency)],
      ["Feed consumed", `${Number(totals.consumed_kg ?? 0).toFixed(3)} kg`],
      ["Consumption cost", money(totals.consumption_cost, context.farm.currency)],
      ["Feed wastage", `${Number(totals.wastage_kg ?? 0).toFixed(3)} kg`],
      ["Wastage cost", money(totals.wastage_cost, context.farm.currency)],
      ["Paid to suppliers", money(totals.supplier_paid, context.farm.currency)],
      ["Supplier payables", money(totals.supplier_payable, context.farm.currency)],
      ["Current stock", `${Number(totals.current_stock ?? 0).toFixed(3)} kg`],
      ["Current inventory value", money(totals.current_inventory_value, context.farm.currency)],
    ]}/>
    <ReportTable headers={["Feed type","Current kg","WAC","Inventory value","Expected / day","Runway","Expected to run out","Forecast basis","Alert"]} rows={(balances ?? []).filter((item) => !type || item.feed_type_id === type).map((item) => { const quantity=Number(item.quantity_kg??0),demand=Number(item.planned_daily_demand??0)>0?Number(item.planned_daily_demand):Number(item.average_daily_consumption??0);return [item.feed_type_name,item.quantity_kg,money(item.weighted_average_cost,context.farm.currency),money(item.inventory_value,context.farm.currency),demand>0?`${demand.toFixed(3)} kg` : "Not available",formatFeedRunway(item.days_remaining==null?null:Number(item.days_remaining),quantity),item.estimated_finish_date?formatFarmDate(item.estimated_finish_date):"Not estimated",feedForecastBasisLabel(item.forecast_basis),item.alert_level]; })} empty="No feed types or activity recorded."/>
  </div>;
}
