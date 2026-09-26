import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { farmToday, formatFarmDate } from "@/lib/farm-date";
import { FeedingPlanForm } from "@/components/forms/planning-forms";
import { feedForecastBasisLabel, formatFeedRunway } from "@/lib/feed-forecast";

export default async function FeedPlanning() {
  const context = await requireRole(["admin", "manager"]);
  const supabase = await createClient();
  const [{ data: plans }, { data: flocks }, { data: types }, { data: forecasts }] = await Promise.all([
    supabase.from("v_flock_feed_plan_daily").select("id,effective_from,effective_to,target_kg_per_day,flocks(flock_name),feed_types(name)").eq("farm_id", context.farm.id).order("effective_from", { ascending: false }),
    supabase.from("v_current_flock_status").select("flock_id,flock_name,current_live_birds").eq("farm_id", context.farm.id).eq("status", "active"),
    supabase.from("feed_types").select("id,name").eq("farm_id", context.farm.id).eq("active", true),
    supabase.from("v_feed_forecast").select("feed_type_id,feed_type_name,quantity_kg,days_remaining,estimated_finish_date,planned_daily_demand,average_daily_consumption,forecast_basis,alert_level").eq("farm_id", context.farm.id).order("days_remaining", { ascending: true, nullsFirst: false }),
  ]);

  return <div>
    <h1 className="text-3xl font-bold">Feed planning</h1>
    <p className="mt-2 text-stone-600">Set the total kilograms of feed each layer flock receives per day. Rearing batch targets are managed on each batch; both are included in the shared stock forecast.</p>
    <Card className="mt-6 p-5"><FeedingPlanForm flocks={(flocks ?? []).map((flock) => ({ id: flock.flock_id, name: flock.flock_name, birds: flock.current_live_birds }))} types={types ?? []} today={farmToday(context.farm.timezone)}/></Card>

    <Card className="mt-6 overflow-hidden">
      <div className="border-b border-stone-100 p-5"><h2 className="font-semibold">Configured layer-flock plans</h2><p className="mt-1 text-sm text-stone-500">Each target is the total amount for the flock per day. Update it when the flock’s daily ration changes; past consumption records remain unchanged.</p></div>
      <div className="grid grid-cols-2 gap-3 bg-stone-50 p-4 text-xs font-semibold text-stone-600 sm:grid-cols-4"><span>Flock</span><span>Feed</span><span>Effective period</span><span>Total feed per day</span></div>
      {plans?.map((plan) => <div key={plan.id} className="grid grid-cols-2 gap-3 border-t border-stone-100 p-4 text-sm sm:grid-cols-4"><span>{plan.flocks?.[0]?.flock_name}</span><span>{plan.feed_types?.[0]?.name}</span><span>{formatFarmDate(plan.effective_from)}{plan.effective_to?` – ${formatFarmDate(plan.effective_to)}`:" onward"}</span><span className="font-semibold">{Number(plan.target_kg_per_day).toLocaleString()} kg/day</span></div>)}
      {!plans?.length && <p className="p-6 text-sm text-stone-500">No layer-flock feeding plans have been configured.</p>}
    </Card>

    <Card className="mt-6 overflow-hidden">
      <div className="border-b border-stone-100 p-5"><h2 className="font-semibold">Farm-wide forecast &amp; stock runway</h2><p className="mt-1 text-sm text-stone-500">Layer demand uses the total daily amount entered for each flock. Rearing demand uses its age-specific plan. Where no current plan exists, recent actual consumption is used as a fallback.</p></div>
      <div className="grid grid-cols-2 gap-3 bg-stone-50 p-4 text-xs font-semibold text-stone-600 sm:grid-cols-5"><span>Feed type</span><span>On hand</span><span>Expected / day</span><span>Stock runway</span><span>Expected to run out</span></div>
      {forecasts?.map((forecast) => {
        const quantity = Number(forecast.quantity_kg ?? 0);
        const demand = Number(forecast.planned_daily_demand ?? 0) > 0 ? Number(forecast.planned_daily_demand) : Number(forecast.average_daily_consumption ?? 0);
        return <div key={forecast.feed_type_id} className="grid grid-cols-2 gap-3 border-t border-stone-100 p-4 text-sm sm:grid-cols-5">
          <span className="font-medium">{forecast.feed_type_name}<small className="mt-1 block text-xs font-normal text-stone-500">{feedForecastBasisLabel(forecast.forecast_basis)}</small></span>
          <span>{quantity.toLocaleString()} kg</span>
          <span>{demand > 0 ? `${demand.toFixed(3)} kg` : "Not available"}</span>
          <span className="font-semibold">{formatFeedRunway(forecast.days_remaining == null ? null : Number(forecast.days_remaining), quantity)}</span>
          <span>{forecast.estimated_finish_date ? formatFarmDate(forecast.estimated_finish_date) : "Not estimated"}</span>
        </div>;
      })}
      {!forecasts?.length && <p className="p-6 text-sm text-stone-500">No active feed types to forecast yet.</p>}
      <p className="border-t border-stone-100 bg-white p-4 text-xs leading-5 text-stone-500">Runway is available stock ÷ expected daily demand. It is an estimate—not a reservation—and only posted feed-consumption movements change stock. Each feed product is forecast independently.</p>
    </Card>
  </div>;
}
