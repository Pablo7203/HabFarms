"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adminUpdateFlockAction, createFlockAction, updateFlockAction } from "@/app/actions/operations";
import { adminFlockUpdateSchema, flockSchema, flockUpdateSchema } from "@/lib/validation/operations";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Values = {
  flockName: string;
  batchReference: string;
  breed: string;
  housePen: string;
  startDate: string;
  initialBirds: number | string;
  ageAtArrivalWeeks: number | string;
  source: string;
  notes: string;
  status: "active" | "closed" | "sold" | "culled";
  correctionReason: string;
  expectedInitialBirds?: number | string;
  expectedStartDate?: string;
};

export function FlockForm({
  flock,
  isAdmin = false,
  currentLive,
}: {
  flock?: Values & { id: string };
  isAdmin?: boolean;
  currentLive?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const schema = flock ? (isAdmin ? adminFlockUpdateSchema : flockUpdateSchema) : flockSchema;
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: flock ?? {
      status: "active",
      startDate: new Date().toISOString().slice(0, 10),
      initialBirds: "",
      batchReference: "",
      breed: "",
      housePen: "",
      source: "",
      notes: "",
      ageAtArrivalWeeks: "",
      correctionReason: "",
    },
  });
  const changedOpening = Boolean(flock && isAdmin && Number(watch("initialBirds")) !== Number(flock.initialBirds));
  const changedStartDate = Boolean(flock && isAdmin && watch("startDate") !== flock.startDate);
  const needsReason = changedOpening || changedStartDate;

  const field = (name: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm font-medium">
      {label}
      <Input className="mt-2" {...props} {...register(name)} />
      {errors[name] && <span className="mt-1 block text-sm text-red-700">{String(errors[name]?.message)}</span>}
    </label>
  );

  return (
    <form className="grid gap-5 sm:grid-cols-2" onSubmit={handleSubmit((values) => start(async () => {
      setError("");
      setSuccess("");
      if (flock && isAdmin && needsReason && values.correctionReason.trim().length < 5) {
        setError("Add a correction reason of at least 5 characters before changing opening birds or the start date.");
        return;
      }
      const result = flock
        ? isAdmin
          ? await adminUpdateFlockAction(flock.id, values)
          : await updateFlockAction(flock.id, values)
        : await createFlockAction(values);
      if (!result.ok) setError(result.message);
      else if (!flock && result.id) router.push(`/flocks/${result.id}`);
      else {
        setSuccess(result.message);
        router.refresh();
      }
    }))}>
      {flock && currentLive !== undefined && (
        <Card className="grid gap-4 bg-stone-50 p-4 sm:col-span-2 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Opening birds</p>
            <p className="mt-1 text-xl font-bold text-stone-900">{Number(flock.initialBirds).toLocaleString()}</p>
            <p className="mt-1 text-xs text-stone-500">Baseline used by the flock’s population history.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Current live · read-only</p>
            <p className="mt-1 text-xl font-bold text-stone-900">{Number(currentLive).toLocaleString()}</p>
            <p className="mt-1 text-xs text-stone-500">Calculated from the opening count and dated bird movements.</p>
          </div>
        </Card>
      )}

      {field("flockName", "Flock name *")}
      {field("batchReference", "Batch reference")}
      {field("breed", "Breed")}
      {field("housePen", "House / pen")}
      {flock && !isAdmin ? (
        <div className="block text-sm font-medium">
          Started date
          <input type="hidden" {...register("startDate")} />
          <p className="mt-2 flex min-h-11 items-center rounded-xl border border-stone-200 bg-stone-50 px-3 text-stone-600">{flock.startDate}</p>
          <span className="mt-1 block text-xs font-normal text-stone-500">Only a Farm Admin can make an audited date correction.</span>
        </div>
      ) : field("startDate", "Started date *", { type: "date" })}
      {flock && isAdmin && field("initialBirds", "Initial birds *", { type: "number", min: flock ? (Number(flock.initialBirds) === 0 ? 0 : 1) : 1, step: 1, inputMode: "numeric" })}
      {!flock && field("initialBirds", "Initial birds *", { type: "number", min: 1, step: 1, inputMode: "numeric" })}
      {field("ageAtArrivalWeeks", "Age at arrival (weeks)", { type: "number", min: 0, step: 1, inputMode: "numeric" })}
      {field("source", "Source")}
      {flock && (
        <label className="block text-sm font-medium">
          Status
          <select className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3" {...register("status")}>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="sold">Sold</option>
            <option value="culled">Culled</option>
          </select>
        </label>
      )}

      {flock && isAdmin && (
        <div className="sm:col-span-2">
          <Card className="border-amber-200 bg-amber-50/70 p-4">
            <p className="font-semibold text-amber-950">Population history stays ledger-based</p>
            <p className="mt-1 text-sm text-amber-900">Changing Initial birds corrects the opening baseline and may recalculate historical live-bird and Hen-Day figures. The app checks the full movement history and records the old and new values in the audit log. Current live cannot be typed over; record a dated bird movement to correct it.</p>
            <p className="mt-2 text-sm text-amber-900">The started date cannot be moved past any existing flock activity. A correction reason is required if either protected value changes.</p>
          </Card>
          <label className="mt-4 block text-sm font-medium">
            Correction reason {needsReason ? "*" : "(required if changing opening birds or started date)"}
            <textarea className="mt-2 min-h-24 w-full rounded-xl border border-stone-300 bg-white p-3" maxLength={1000} {...register("correctionReason")} placeholder="For example: verified against the supplier delivery record." />
          </label>
        </div>
      )}

      <label className="block text-sm font-medium sm:col-span-2">Notes<textarea className="mt-2 min-h-28 w-full rounded-xl border border-stone-300 p-3" {...register("notes")} /></label>
      {(error || success) && <p aria-live="polite" className={`text-sm sm:col-span-2 ${error ? "text-red-700" : "text-emerald-800"}`}>{error || success}</p>}
      <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Saving..." : flock ? "Save flock" : "Create flock"}</Button></div>
    </form>
  );
}
