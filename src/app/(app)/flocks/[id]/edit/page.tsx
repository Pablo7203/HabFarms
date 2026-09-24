import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { FlockForm } from "@/components/forms/flock-form";

export default async function EditFlock({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: flock }, { data: status }] = await Promise.all([
    supabase.from("flocks").select("*").eq("id", id).eq("farm_id", context.farm.id).maybeSingle(),
    supabase.from("v_current_flock_status").select("current_live_birds").eq("flock_id", id).eq("farm_id", context.farm.id).maybeSingle(),
  ]);
  if (!flock || !status) notFound();
  return (
    <div>
      <p className="text-sm font-medium text-emerald-800">Farm operations</p>
      <h1 className="mt-1 text-3xl font-bold">Edit flock</h1>
      <p className="mt-2 max-w-2xl text-sm text-stone-600">Update flock details. Farm Admins can also make controlled corrections to opening birds and the started date.</p>
      <Card className="mt-7 p-5 sm:p-7">
        <FlockForm
          isAdmin={context.membership.role === "admin"}
          currentLive={status.current_live_birds}
          flock={{
            id: flock.id,
            flockName: flock.flock_name,
            batchReference: flock.batch_reference ?? "",
            breed: flock.breed ?? "",
            housePen: flock.house_pen ?? "",
            startDate: flock.start_date,
            initialBirds: flock.initial_birds,
            ageAtArrivalWeeks: flock.age_at_arrival_weeks ?? "",
            source: flock.source ?? "",
            notes: flock.notes ?? "",
            status: flock.status,
            correctionReason: "",
            expectedInitialBirds: flock.initial_birds,
            expectedStartDate: flock.start_date,
          }}
        />
      </Card>
    </div>
  );
}
