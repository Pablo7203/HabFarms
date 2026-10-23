import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange, money } from "@/lib/reporting";
import { DateFilter, Kpis } from "@/components/reports/report-ui";
import { ReportTable } from "@/components/reports/report-table";

const healthTypes = ["vaccine", "antibiotic", "vitamin", "dewormer", "treatment", "veterinary_service", "other"] as const;

export default async function HealthReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await requireAppContext();
  const query = await searchParams;
  const range = reportRange(context.farm.timezone, query);
  const supabase = await createClient();
  const flock = query.flock || null;
  const healthType = query.healthType || query.type || null;
  const financial = context.membership.role !== "worker";
  const [{ data: records }, { data: flocks }, summaryResult] = await Promise.all([
    supabase.from("health_records").select("*,flocks(flock_name)").eq("farm_id", context.farm.id).eq("status", "active").gte("record_date", range.from).lte("record_date", range.to).order("record_date", { ascending: false }),
    supabase.from("flocks").select("id,flock_name").eq("farm_id", context.farm.id),
    financial ? supabase.rpc("get_health_report_summary", { start_date: range.from, end_date: range.to, target_flock: flock, target_type: healthType }) : Promise.resolve({ data: null }),
  ]);
  const filtered = (records ?? []).filter((record) => (!flock || record.flock_id === flock) && (!healthType || record.health_type === healthType));
  const totals = summaryResult.data?.[0];

  return <div>
    <h1 className="text-3xl font-bold">Health report</h1>
    <DateFilter from={range.from} to={range.to} exportType="health">
      <label className="text-sm font-medium">Flock<select name="flock" defaultValue={flock ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All flocks</option>{flocks?.map((item) => <option key={item.id} value={item.id}>{item.flock_name}</option>)}</select></label>
      <label className="text-sm font-medium">Activity type<select name="healthType" defaultValue={healthType ?? ""} className="mt-2 min-h-11 w-full rounded-lg border px-3"><option value="">All activity types</option>{healthTypes.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
    </DateFilter>
    <Kpis items={[["Health records", Number(totals?.record_count ?? filtered.length)], ...(financial ? [["Health cost", money(totals?.health_cost, context.farm.currency)], ["Upcoming actions", Number(totals?.upcoming_count ?? 0)]] as Array<[string, string | number]> : [["Upcoming actions", filtered.filter((record) => record.next_due_date).length] as [string, number]])]} />
    <ReportTable headers={["Date", "Flock", "Type", "Product", "Reason", ...(financial ? ["Cost"] : []), "Next due"]} rows={filtered.map((record) => [record.record_date, record.flocks?.flock_name, record.health_type.replaceAll("_", " "), record.product_name, record.reason || "—", ...(financial ? [money(record.cost, context.farm.currency)] : []), record.next_due_date || "—"])} empty="No health records for this period." />
  </div>;
}
