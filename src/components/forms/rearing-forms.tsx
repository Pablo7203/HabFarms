"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { changeRearingStageAction, createRearingBatchAction, postBroilerDispatchAction, recordRearingWeightSampleAction, saveRearingDailyRecordAction, updateRearingBatchAction } from "@/app/actions/rearing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };
type BatchValues = { batchCode?: string; birdPurpose?: "layer_pullet" | "broiler"; breed: string; supplierId: string; arrivalDate: string; hatchDate: string; initialQuantity?: number; notes: string };
export function RearingStageForm({ batchId, stage, stages }: { batchId: string; stage: string; stages: { value: string; label: string }[] }) {
  const [pending, start] = useTransition(), [selectedStage, setSelectedStage] = useState(stage), [error, setError] = useState(""), [message, setMessage] = useState(""), router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const values = new FormData(event.currentTarget);
    start(async () => {
      const result = await changeRearingStageAction(batchId, values);
      if (!result.ok) { setError(result.message); return; }
      setMessage(result.message);
      router.refresh();
    });
  }
  return <form onSubmit={submit} className="flex w-full flex-wrap gap-2 sm:w-auto">
    <label className="sr-only" htmlFor="batch-stage">Set batch stage</label>
    <select id="batch-stage" name="stage" value={selectedStage} onChange={event => setSelectedStage(event.target.value)} disabled={pending} className="min-h-11 flex-1 rounded-lg border border-stone-300 bg-white px-3 disabled:opacity-60 sm:flex-none">
      {stages.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <Button disabled={pending} variant="secondary">{pending ? "Saving stage…" : "Save stage"}</Button>
    {error && <p role="alert" className="basis-full rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="basis-full rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
  </form>;
}

export function RearingBatchForm({ today, suppliers, batch }: { today: string; suppliers: Supplier[]; batch?: BatchValues & { id: string } }) {
  const [pending, start] = useTransition(), [error, setError] = useState(""), router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    start(async () => {
      const result = batch ? await updateRearingBatchAction(batch.id, values) : await createRearingBatchAction(values);
      if (!result.ok) setError(result.message);
      else if (!batch && result.id) router.push(`/rearing/${result.id}`);
      else { router.refresh(); setError(""); }
    });
  }
  const label = "block text-sm font-semibold text-stone-700";
  const input = "mt-2";
  return <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
    {!batch && <label className={label}>Batch code <span className="font-normal text-stone-500">(optional; generated if blank)</span><Input name="batchCode" maxLength={40} placeholder="DOC-2026-001" className={input}/></label>}
    <label className={label}>Breed / strain *<Input name="breed" required maxLength={120} defaultValue={batch?.breed} placeholder="e.g. ISA Brown" className={input}/></label>
    {!batch && <label className={label}>Bird purpose<select name="birdPurpose" defaultValue="layer_pullet" required className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"><option value="layer_pullet">Layer pullets</option><option value="broiler">Broilers</option></select><span className="mt-1 block text-xs font-normal text-stone-500">This determines the lifecycle stages and whether birds transfer to layer flocks or use broiler dispatch.</span></label>}
    <label className={label}>Supplier <select name="supplierId" defaultValue={batch?.supplierId ?? ""} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"><option value="">No supplier recorded</option>{suppliers.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
    <label className={label}>Arrival date *<Input name="arrivalDate" type="date" required max={today} readOnly={!!batch} defaultValue={batch?.arrivalDate ?? today} className={`${input} read-only:bg-stone-50 read-only:text-stone-500`}/></label>
    <label className={label}>Hatch date <span className="font-normal text-stone-500">(if known)</span><Input name="hatchDate" type="date" max={batch?.arrivalDate ?? today} defaultValue={batch?.hatchDate} className={input}/></label>
    {!batch && <label className={label}>Initial chicks *<Input name="initialQuantity" type="number" min={1} step={1} inputMode="numeric" required className={input}/></label>}
    <label className={`${label} sm:col-span-2`}>Notes<textarea name="notes" maxLength={2000} defaultValue={batch?.notes} className="mt-2 min-h-28 w-full rounded-lg border border-stone-300 bg-white p-3 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" placeholder="Optional acquisition or arrival notes"/></label>
    <p className="text-xs leading-5 text-stone-500 sm:col-span-2">The initial quantity is posted once to a separate rearing population ledger. It does not add birds to a layer flock or create a financial transaction.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Saving…" : batch ? "Save batch details" : "Create rearing batch"}</Button></div>
  </form>;
}

export function RearingDailyForm({ batchId, today, arrivalDate, openingBirds, broiler, record }: { batchId: string; today: string; arrivalDate: string; openingBirds: number; broiler?: boolean; record?: { id: string; recordDate: string; deaths: number; observations: string; feedCheck?: string | null; waterCheck?: string | null; brooderTemperatureC?: number | null } }) {
  const [pending, start] = useTransition(), [error, setError] = useState(""), [message, setMessage] = useState(""), [deaths, setDeaths] = useState(record?.deaths ?? 0), router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    start(async () => { const result = await saveRearingDailyRecordAction(batchId, record?.id ?? null, values); if (!result.ok) setError(result.message); else { setMessage(result.message); router.refresh(); } });
  }
  const closingBirds = Math.max(0, openingBirds - Number(deaths));
  return <form onSubmit={submit} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Date<Input className="mt-2" type="date" name="recordDate" required min={arrivalDate} max={today} defaultValue={record?.recordDate ?? today} readOnly={!!record}/></label>
      <div className="rounded-xl bg-stone-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Opening birds · read only</p><p className="data-number mt-2 text-2xl font-bold">{openingBirds.toLocaleString()}</p></div></div>
    <label className="block text-sm font-semibold">Deaths today *<Input className="mt-2" type="number" name="deaths" min={0} max={openingBirds} step={1} inputMode="numeric" required value={deaths} onChange={(event)=>setDeaths(Number(event.target.value))}/><span className="mt-1 block text-xs font-normal text-stone-500">Enter 0 when there were no deaths. Each non-zero value posts one batch-linked mortality movement.</span></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">Feed check <span className="font-normal text-stone-500">(optional)</span><select name="feedCheck" defaultValue={record?.feedCheck ?? ""} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"><option value="">Not recorded</option><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="not_checked">Not checked</option></select></label><label className="block text-sm font-semibold">Water check <span className="font-normal text-stone-500">(optional)</span><select name="waterCheck" defaultValue={record?.waterCheck ?? ""} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3"><option value="">Not recorded</option><option value="normal">Normal</option><option value="reduced">Reduced</option><option value="not_checked">Not checked</option></select></label>{broiler&&<label className="block text-sm font-semibold">Brooder temperature °C <span className="font-normal text-stone-500">(optional)</span><Input name="brooderTemperatureC" type="number" min={-10} max={60} step="0.1" defaultValue={record?.brooderTemperatureC ?? ""} className="mt-2"/></label>}</div>
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Closing birds · calculated</p><p className="data-number mt-2 text-2xl font-bold text-emerald-950">{closingBirds.toLocaleString()}</p><p className="mt-1 text-xs text-emerald-900/80">This preview updates after saving from the authoritative population ledger.</p></div>
    <label className="block text-sm font-semibold">Observations<textarea name="observations" maxLength={2000} defaultValue={record?.observations ?? ""} className="mt-2 min-h-32 w-full rounded-lg border border-stone-300 bg-white p-3 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" placeholder="Bird activity, water, brooder checks, or other observations"/></label>
    <p className="text-xs leading-5 text-stone-500">Deaths and observations save to this daily record. Record actual feed consumption in the shared-stock section below; health activities and attributed costs are recorded in their sections on the batch page.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <Button disabled={pending}>{pending ? "Saving…" : record ? "Save audited correction" : "Save daily record"}</Button>
  </form>;
}

export function RearingWeightSampleForm({ batchId, today, arrivalDate }: { batchId: string; today: string; arrivalDate: string }) {
  const [pending, start] = useTransition(), [message, setMessage] = useState(""), [error, setError] = useState(""), router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setError(""); const form = event.currentTarget, values = Object.fromEntries(new FormData(form).entries());
    start(async () => { const result = await recordRearingWeightSampleAction(batchId, values); if (!result.ok) setError(result.message); else { setMessage(result.message); form.reset(); router.refresh(); } });
  }
  return <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
    <label className="text-sm font-semibold">Sample date<Input name="sampleDate" type="date" min={arrivalDate} max={today} defaultValue={today} required className="mt-2"/></label>
    <label className="text-sm font-semibold">Birds weighed<Input name="sampleSize" type="number" min={1} step={1} required className="mt-2" placeholder="e.g. 20"/></label>
    <label className="text-sm font-semibold">Average live weight (kg)<Input name="averageWeightKg" type="number" min="0.001" max="50" step="0.001" required className="mt-2" placeholder="e.g. 0.850"/></label>
    <label className="text-sm font-semibold">Uniformity % <span className="font-normal text-stone-500">(optional)</span><Input name="uniformityPercentage" type="number" min="0" max="100" step="0.1" className="mt-2" placeholder="e.g. 82"/></label>
    <label className="text-sm font-semibold sm:col-span-2">Notes<textarea name="notes" maxLength={2000} className="mt-2 min-h-20 w-full rounded-lg border border-stone-300 p-3 font-normal"/></label>
    <p className="text-xs leading-5 text-stone-500 sm:col-span-2">Use a consistent, representative sample. Compare the trend with the breed guide; the app does not diagnose health or prescribe feed.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-stone-50 p-3 text-sm sm:col-span-2">{message}</p>}
    <Button disabled={pending} className="sm:col-span-2">{pending ? "Saving sample…" : "Record growth sample"}</Button>
  </form>;
}

export function BroilerDispatchForm({ batchId, today, arrivalDate, availableBirds }: { batchId: string; today: string; arrivalDate: string; availableBirds: number }) {
  const [pending, start] = useTransition(), [message, setMessage] = useState(""), [error, setError] = useState(""), router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setError(""); const form = event.currentTarget, values = Object.fromEntries(new FormData(form).entries());
    start(async () => { const result = await postBroilerDispatchAction(batchId, values); if (!result.ok) setError(result.message); else { setMessage(result.message); form.reset(); router.refresh(); } });
  }
  return <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
    <label className="text-sm font-semibold">Sale / dispatch date<Input name="dispatchDate" type="date" min={arrivalDate} max={today} defaultValue={today} required className="mt-2"/></label>
    <label className="text-sm font-semibold">Birds leaving batch<Input name="quantity" type="number" min={1} max={availableBirds} step={1} required className="mt-2"/><span className="mt-1 block text-xs font-normal text-stone-500">{availableBirds.toLocaleString()} currently available</span></label>
    <label className="text-sm font-semibold">Buyer / destination <span className="font-normal text-stone-500">(optional)</span><Input name="buyerName" maxLength={160} className="mt-2"/></label>
    <label className="text-sm font-semibold">Sale amount <span className="font-normal text-stone-500">(optional; separate from egg sales)</span><Input name="totalAmount" type="number" min="0" step="0.01" defaultValue="0" required className="mt-2"/></label>
    <label className="text-sm font-semibold sm:col-span-2">Notes<textarea name="notes" maxLength={2000} className="mt-2 min-h-20 w-full rounded-lg border border-stone-300 p-3 font-normal"/></label>
    <p className="text-xs leading-5 text-amber-900 sm:col-span-2">Posting reduces the batch’s live-bird balance. This dispatch is separate from egg sales, customer collections and cash-flow reporting.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-stone-50 p-3 text-sm sm:col-span-2">{message}</p>}
    <Button disabled={pending} className="sm:col-span-2">{pending ? "Recording…" : "Record broiler sale / dispatch"}</Button>
  </form>;
}
