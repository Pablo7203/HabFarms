import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday, formatFarmDate } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { RearingDailyForm } from "@/components/forms/rearing-forms";
import { RearingFeedConsumptionForm } from "@/components/forms/rearing-phase2-forms";

export const metadata = { title: "Daily rearing record" };

export default async function RearingDailyPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ record?: string }>;
}) {
  const { batchId } = await params;
  const query = await searchParams;
  const context = await requireAppContext();
  const supabase = await createClient();
  const [{ data: batch }, { data: record }] = await Promise.all([
    supabase
      .from("rearing_batches")
      .select("id,batch_code,arrival_date,status,feeding_stage,current_birds")
      .eq("id", batchId)
      .eq("farm_id", context.farm.id)
      .maybeSingle(),
    query.record
      ? supabase
          .from("rearing_daily_records")
          .select("id,record_date,deaths,observations")
          .eq("id", query.record)
          .eq("rearing_batch_id", batchId)
          .eq("farm_id", context.farm.id)
          .maybeSingle()
      : supabase
          .from("rearing_daily_records")
          .select("id,record_date,deaths,observations")
          .eq("rearing_batch_id", batchId)
          .eq("farm_id", context.farm.id)
          .eq("record_date", farmToday(context.farm.timezone))
          .maybeSingle(),
  ]);
  if (!batch) notFound();
  if (query.record && !record) notFound();

  const today = farmToday(context.farm.timezone);
  const recordDate = record?.record_date ?? today;
  const canOperate =
    ["active", "partially_transferred"].includes(batch.status) &&
    Number(batch.current_birds) > 0;
  const { data: opening, error } = await supabase.rpc("rearing_balance_at", {
    target_batch: batchId,
    target_date: recordDate,
  });
  if (error) throw new Error("Could not calculate the population at this date.");

  const [{ data: feedTypes }, { data: feedRows }] = await Promise.all([
    supabase
      .from("feed_types")
      .select("id,name")
      .eq("farm_id", context.farm.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("v_rearing_feed_history")
      .select("id,feed_name,consumption_date,quantity_kg,active")
      .eq("farm_id", context.farm.id)
      .eq("rearing_batch_id", batchId)
      .eq("consumption_date", recordDate)
      .eq("active", true)
      .order("created_at"),
  ]);
  const isWorker = context.membership.role === "worker";

  return (
    <div
      className="mx-auto max-w-3xl"
      data-batch-operational={canOperate ? "true" : "false"}
    >
      <Link
        href={`/rearing/${batchId}`}
        className="text-sm font-semibold text-emerald-800"
      >
        ← Back to {batch.batch_code}
      </Link>
      <h1 className="mt-4 text-3xl font-bold">
        {isWorker && record
          ? "Today’s daily record"
          : record
            ? canOperate
              ? "Correct daily record"
              : "Daily record"
            : "Daily rearing entry"}
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        Batch {batch.batch_code} · {formatFarmDate(recordDate)}. Deaths are
        posted once to this batch’s population ledger.
      </p>

      {!canOperate && (
        <Card
          role="status"
          className="mt-5 border-stone-200 bg-stone-50 p-4 text-sm text-stone-700"
        >
          This batch has no birds currently in rearing or is closed. This page
          is read-only; historical records remain available.
        </Card>
      )}

      <Card className="mt-6 p-5 sm:p-7">
        {isWorker && record ? (
          <div>
            <p className="text-sm font-semibold text-stone-500">
              Deaths recorded
            </p>
            <p className="data-number mt-1 text-2xl font-bold">
              {record.deaths}
            </p>
            <p className="mt-5 text-sm font-semibold text-stone-500">
              Observations
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">
              {record.observations || "No observations recorded."}
            </p>
            <p className="mt-5 text-xs text-stone-500">
              Workers can record today’s operations but cannot correct a posted
              record.
            </p>
          </div>
        ) : canOperate ? (
          <RearingDailyForm
            batchId={batchId}
            today={today}
            arrivalDate={batch.arrival_date}
            openingBirds={Number(opening ?? 0)}
            record={
              record
                ? {
                    id: record.id,
                    recordDate: record.record_date,
                    deaths: record.deaths,
                    observations: record.observations ?? "",
                  }
                : undefined
            }
          />
        ) : record ? (
          <div>
            <p className="text-sm font-semibold text-stone-500">
              Deaths recorded
            </p>
            <p className="data-number mt-1 text-2xl font-bold">
              {record.deaths}
            </p>
            <p className="mt-5 text-sm font-semibold text-stone-500">
              Observations
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">
              {record.observations || "No observations recorded."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-stone-600">
            No daily record was submitted for this date. No zero-activity record
            is inferred.
          </p>
        )}
      </Card>

      <Card className="mt-5 overflow-hidden">
        <div className="border-b border-stone-100 p-5">
          <h2 className="font-semibold">Actual feed consumed</h2>
          <p className="mt-1 text-sm text-stone-500">
            Feed quantities post to shared stock and are linked to this daily
            record.
          </p>
        </div>
        {canOperate ? (
          <div className="p-5">
            <RearingFeedConsumptionForm
              batchId={batchId}
              today={today}
              arrivalDate={batch.arrival_date}
              feedTypes={(feedTypes ?? []).map((x) => ({
                id: x.id,
                name: x.name,
              }))}
              dailyRecordId={record?.id}
              date={recordDate}
            />
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-stone-600">
            Feed entry is unavailable because this batch has no birds in
            rearing.
          </p>
        )}
        <div className="divide-y divide-stone-100">
          {feedRows?.map((row) => (
            <div
              key={row.id}
              className="flex justify-between gap-3 px-5 py-3 text-sm"
            >
              <span>
                {row.feed_name} · {Number(row.quantity_kg).toLocaleString()} kg
              </span>
              <span className="text-stone-500">
                {row.active ? "Posted" : "Reversed"}
              </span>
            </div>
          ))}
          {!feedRows?.length && (
            <p className="px-5 pb-5 text-sm text-stone-500">
              No feed use recorded for this date. This is not confirmation of
              zero consumption.
            </p>
          )}
        </div>
      </Card>
      <p className="mt-4 text-xs text-stone-500">
        Dates follow {context.farm.timezone}. A record cannot predate the batch
        arrival or be future-dated.
      </p>
    </div>
  );
}
