import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { RearingBatchForm } from "@/components/forms/rearing-forms";

export const metadata = { title: "Edit rearing batch" };

export default async function EditRearingBatch({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const context = await requireRole(["admin", "manager"]);
  const supabase = await createClient();
  const [{ data: batch }, { data: suppliers }] = await Promise.all([
    supabase
      .from("rearing_batches")
      .select("*")
      .eq("id", batchId)
      .eq("farm_id", context.farm.id)
      .maybeSingle(),
    supabase
      .from("suppliers")
      .select("id,name")
      .eq("farm_id", context.farm.id)
      .eq("active", true)
      .order("name"),
  ]);
  if (!batch) notFound();

  const editable = ["active", "partially_transferred"].includes(batch.status);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/rearing/${batchId}`}
        className="text-sm font-semibold text-emerald-800"
      >
        ← Back to {batch.batch_code}
      </Link>
      <h1 className="mt-4 text-3xl font-bold">
        {editable ? "Edit batch details" : "Batch details are read-only"}
      </h1>
      {editable ? (
        <>
          <p className="mt-2 text-sm text-stone-600">
            The arrival date, batch code, and initial population are fixed after
            the opening movement is posted.
          </p>
          <Card className="mt-6 p-5 sm:p-7">
            <RearingBatchForm
              today={farmToday(context.farm.timezone)}
              suppliers={suppliers ?? []}
              batch={{
                id: batch.id,
                batchCode: batch.batch_code,
                breed: batch.breed_or_strain,
                supplierId: batch.supplier_id ?? "",
                arrivalDate: batch.arrival_date,
                hatchDate: batch.hatch_date ?? "",
                initialQuantity: batch.initial_quantity,
                notes: batch.notes ?? "",
              }}
            />
          </Card>
        </>
      ) : (
        <Card
          role="status"
          className="mt-6 border-stone-200 bg-stone-50 p-5 text-sm text-stone-700"
        >
          This batch is {batch.status}. Its historical details remain available
          for review, but it can no longer be edited.
        </Card>
      )}
    </div>
  );
}
