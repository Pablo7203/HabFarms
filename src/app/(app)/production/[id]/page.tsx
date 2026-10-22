import { deleteProductionAction } from "@/app/actions/operations";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Card } from "@/components/ui/card";
import { formatFarmDate } from "@/lib/farm-date";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/auth/context";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ProductionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireAppContext();
  const supabase = await createClient();
  const [{ data: record }, { data: detail }] = await Promise.all([
    supabase.from("v_daily_production_metrics").select("*").eq("production_id", id).maybeSingle(),
    supabase.from("daily_production_records").select("flocks(flock_name)").eq("id", id).maybeSingle(),
  ]);

  if (!record) notFound();

  const flock = Array.isArray(detail?.flocks) ? detail.flocks[0] : detail?.flocks;
  const canEdit = context.membership.role !== "worker";
  const metrics = [
    ["Eggs collected", record.eggs_collected],
    ["Good eggs", record.good_eggs],
    ["Cracked eggs", record.cracked_eggs],
    ["Hen-Day", record.hen_day_percentage == null ? "—" : `${record.hen_day_percentage}%`],
    ["Live birds basis", record.live_birds],
    ["Feed consumed", `${record.feed_consumed_kg} kg`],
    ["Feed per bird", record.feed_per_bird == null ? "—" : `${(record.feed_per_bird * 1000).toFixed(1)} g`],
    ["Feed per egg", record.feed_per_egg == null ? "—" : `${(record.feed_per_egg * 1000).toFixed(1)} g`],
  ];

  return (
    <div>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">{formatFarmDate(record.production_date)}</p>
          <h1 className="mt-1 text-3xl font-bold">{flock?.flock_name}</h1>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/production/${id}/edit`} className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold">
              Edit record
            </Link>
            {context.membership.role === "admin" && (
              <ConfirmActionDialog
                triggerLabel="Delete"
                title="Delete this production record?"
                description="This permanently removes the production entry and reverses its recorded flock, egg, and feed effects. This cannot be undone."
                confirmLabel="Delete record"
                triggerClassName="min-h-11 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                onConfirm={deleteProductionAction.bind(null, id)}
              />
            )}
          </div>
        )}
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card key={String(label)} className="p-5">
            <p className="text-xs text-stone-500">{label}</p>
            <p className="mt-2 text-xl font-bold">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-7 p-6">
        <h2 className="font-semibold">Daily losses and costs</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-4">
          <div><p className="text-xs text-stone-500">Deaths</p><p className="font-semibold">{record.deaths}</p></div>
          <div><p className="text-xs text-stone-500">Culls</p><p className="font-semibold">{record.culls}</p></div>
          <div><p className="text-xs text-stone-500">Transport</p><p className="font-semibold">{money(record.transport_cost, context.farm.currency)}</p></div>
          <div><p className="text-xs text-stone-500">Other</p><p className="font-semibold">{money(record.other_cost, context.farm.currency)}</p></div>
        </div>
        {record.notes && <p className="mt-5 border-t pt-5 text-sm text-stone-600">{record.notes}</p>}
      </Card>
    </div>
  );
}
