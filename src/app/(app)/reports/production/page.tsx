import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange } from "@/lib/reporting";
import { DateFilter, Kpis, SimpleChart } from "@/components/reports/report-ui";
import { ReportTable } from "@/components/reports/report-table";

export default async function ProductionReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireAppContext();
  const query = await searchParams;
  const range = reportRange(context.farm.timezone, query);
  const supabase = await createClient();
  const flock = query.flock || null;
  const [{ data: summary }, { data: records }, { data: flocks }, { data: allGradeRows }] = await Promise.all([
    supabase.rpc("get_production_report", { start_date: range.from, end_date: range.to, target_flock: flock }),
    supabase.from("v_daily_production_metrics").select("*,flocks(flock_name)").eq("farm_id", context.farm.id).gte("production_date", range.from).lte("production_date", range.to).order("production_date", { ascending: false }),
    supabase.from("flocks").select("id,flock_name").eq("farm_id", context.farm.id),
    supabase.from("v_production_by_grade").select("*").eq("farm_id", context.farm.id).gte("production_date", range.from).lte("production_date", range.to),
  ]);
  const productionRows = (records ?? []).filter((row) => !flock || row.flock_id === flock);
  const recordIds = new Set(productionRows.map((row) => row.production_id));
  const gradeRows = (allGradeRows ?? []).filter((row) => recordIds.has(row.production_record_id));
  const totals = summary?.[0] ?? {};
  const byGrade = Object.values(gradeRows.reduce<Record<string, { name: string; eggs: number }>>((accumulator, row) => {
    accumulator[row.egg_grade_id] ??= { name: row.grade_name, eggs: 0 };
    accumulator[row.egg_grade_id].eggs += Number(row.quantity_eggs);
    return accumulator;
  }, {}));

  return <div>
    <h1 className="text-3xl font-bold">Production by egg grade</h1>
    <DateFilter from={range.from} to={range.to} exportType="production">
      <label className="text-sm font-medium">Flock<select name="flock" defaultValue={flock ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All flocks</option>{flocks?.map((item) => <option key={item.id} value={item.id}>{item.flock_name}</option>)}</select></label>
    </DateFilter>
    <Kpis items={[["Eggs collected", Number(totals.eggs_collected ?? 0)], ["Good eggs", Number(totals.good_eggs ?? 0)], ["Cracked eggs", Number(totals.cracked_eggs ?? 0)], ["Weighted hen-day", totals.hen_day_percentage == null ? "—" : `${Number(totals.hen_day_percentage).toFixed(2)}%`]]} />
    <SimpleChart title="Good egg production" series={productionRows.slice(0, 10).reverse().map((row) => ({ label: row.production_date, value: Number(row.good_eggs) }))} />
    <ReportTable headers={["Egg grade", "Good eggs allocated"]} rows={byGrade.map((row) => [row.name, row.eggs])} empty="No grade allocations in this period." />
    <h2 className="mt-8 text-xl font-semibold">Daily production</h2>
    <ReportTable headers={["Date", "Flock", "Collected", "Good", "Cracked", "Hen-day", "Feed kg", "Deaths", "Culls"]} rows={productionRows.map((row) => [row.production_date, row.flocks?.flock_name, row.eggs_collected, row.good_eggs, row.cracked_eggs, `${Number(row.hen_day_percentage ?? 0).toFixed(2)}%`, row.feed_consumed_kg, row.deaths, row.culls])} empty="No production recorded for this period." />
  </div>;
}
