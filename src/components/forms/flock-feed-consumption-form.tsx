"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { createFlockFeedConsumptionAction, updateFlockFeedConsumptionAction } from "@/app/actions/feed";

type Option = { id: string; name: string };
type State = { ok: boolean; message: string };
const initial: State = { ok: false, message: "" };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="min-h-11 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{pending ? "Saving…" : label}</button>;
}

export function FlockFeedConsumptionForm({ flocks, feedTypes, today, canBackdate, record }: { flocks: Option[]; feedTypes: Option[]; today: string; canBackdate: boolean; record?: { id: string; feedTypeId: string; quantityKg: number; notes: string | null } }) {
  const router = useRouter();
  const action = record ? updateFlockFeedConsumptionAction.bind(null, record.id) : createFlockFeedConsumptionAction;
  const [state, formAction] = useActionState(async (_previous: State, formData: FormData) => {
    const input = record
      ? { feedTypeId: formData.get("feedTypeId"), quantityKg: formData.get("quantityKg"), notes: formData.get("notes") }
      : { flockId: formData.get("flockId"), feedTypeId: formData.get("feedTypeId"), consumptionDate: formData.get("consumptionDate"), quantityKg: formData.get("quantityKg"), notes: formData.get("notes") };
    const result = await action(input);
    return result;
  }, initial);

  useEffect(() => {
    if (state.ok) router.push(record ? "/feed/usage?updated=1" : "/feed/usage?created=1");
  }, [record, router, state.ok]);

  return <form action={formAction} className="space-y-5">
    {record ? <div className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600">Flock and date remain fixed so this correction cannot create a duplicate feed issue.</div> : <>
      <label className="block text-sm font-semibold">Flock<select name="flockId" required defaultValue="" className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"><option value="" disabled>Select an active flock</option>{flocks.map((flock) => <option key={flock.id} value={flock.id}>{flock.name}</option>)}</select></label>
      <label className="block text-sm font-semibold">Date<input name="consumptionDate" type="date" required defaultValue={today} max={today} readOnly={!canBackdate} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"/>{!canBackdate && <span className="mt-1 block text-xs font-normal text-stone-500">Staff can record today’s feed use; ask a manager to correct earlier dates.</span>}</label>
    </>}
    <label className="block text-sm font-semibold">Feed type<select name="feedTypeId" required defaultValue={record?.feedTypeId ?? ""} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"><option value="" disabled>Select a feed type</option>{feedTypes.map((feed) => <option key={feed.id} value={feed.id}>{feed.name}</option>)}</select></label>
    <label className="block text-sm font-semibold">Quantity used (kg)<input name="quantityKg" type="number" inputMode="decimal" min="0.001" step="0.001" max="100000" required defaultValue={record?.quantityKg ?? ""} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"/><span className="mt-1 block text-xs font-normal text-stone-500">This amount is deducted from feed stock in kilograms.</span></label>
    <label className="block text-sm font-semibold">Notes <span className="font-normal text-stone-500">(optional)</span><textarea name="notes" maxLength={2000} rows={3} defaultValue={record?.notes ?? ""} className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5"/></label>
    {state.message && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{state.message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-stone-500">One positive feed-use entry is allowed per flock per day, including daily production entries.</p><Submit label={record ? "Save correction" : "Record feed use"}/></div>
  </form>;
}
