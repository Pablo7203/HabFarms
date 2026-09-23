"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createRearingBatchAction, saveRearingDailyRecordAction, updateRearingBatchAction } from "@/app/actions/rearing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Supplier = { id: string; name: string };
type BatchValues = { batchCode?: string; breed: string; supplierId: string; arrivalDate: string; hatchDate: string; initialQuantity?: number; notes: string };
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

export function RearingDailyForm({ batchId, today, arrivalDate, openingBirds, record }: { batchId: string; today: string; arrivalDate: string; openingBirds: number; record?: { id: string; recordDate: string; deaths: number; observations: string } }) {
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
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Closing birds · calculated</p><p className="data-number mt-2 text-2xl font-bold text-emerald-950">{closingBirds.toLocaleString()}</p><p className="mt-1 text-xs text-emerald-900/80">This preview updates after saving from the authoritative population ledger.</p></div>
    <label className="block text-sm font-semibold">Observations<textarea name="observations" maxLength={2000} defaultValue={record?.observations ?? ""} className="mt-2 min-h-32 w-full rounded-lg border border-stone-300 bg-white p-3 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" placeholder="Bird activity, water, brooder checks, or other observations"/></label>
    <p className="text-xs leading-5 text-stone-500">Deaths and observations save to this daily record. Record actual feed consumption in the shared-stock section below; health activities and attributed costs are recorded in their sections on the batch page.</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <Button disabled={pending}>{pending ? "Saving…" : record ? "Save audited correction" : "Save daily record"}</Button>
  </form>;
}
