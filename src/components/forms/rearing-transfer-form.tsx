"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bird, CircleAlert } from "lucide-react";
import { getRearingTransferPreviewAction, postRearingTransferAction, reverseRearingTransferAction } from "@/app/actions/rearing-phase3";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";

type FlockOption = { id: string; flock_name: string; breed: string | null; batch_reference: string | null; house_pen: string | null; start_date: string; current_live_birds: number };
const label = "block text-sm font-semibold text-stone-700";
const areaClass = "mt-2 min-h-20 w-full rounded-lg border border-stone-300 bg-white p-3 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100";

export function RearingTransferForm({ batchId, batchCode, breed, arrivalDate, today, currentBirds, remainingCost, costComplete, currency, flocks }: {
  batchId: string; batchCode: string; breed: string; arrivalDate: string; today: string; currentBirds: number;
  remainingCost: number; costComplete: boolean; currency: string; flocks: FlockOption[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [destination, setDestination] = useState(flocks[0]?.id ?? "new");
  const [preview, setPreview] = useState({ availableBirds: currentBirds, remainingCost, costComplete });
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [idempotencyFingerprint, setIdempotencyFingerprint] = useState("");
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();

  useEffect(() => {
    let live = true;
    startPreviewTransition(async () => {
      const result = await getRearingTransferPreviewAction(batchId, date);
      if (live && result.ok) setPreview({ availableBirds: result.availableBirds, remainingCost: result.remainingCost, costComplete: result.costComplete });
      if (live && !result.ok) setMessage(result.message ?? "Could not refresh this date.");
    });
    return () => { live = false; };
  }, [batchId, date]);

  const qty = Number(quantity), available = preview.availableBirds;
  const validQty = Number.isInteger(qty) && qty > 0 && qty <= available;
  const transferredCost = validQty ? (qty === available ? preview.remainingCost : Math.round(preview.remainingCost * qty / available * 100) / 100) : 0;
  const unitCost = validQty ? transferredCost / qty : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const form = new FormData(event.currentTarget);
    const request = {
      transferDate: date, quantity,
      destinationFlockId: destination === "new" ? "" : destination,
      newFlockName: String(form.get("flockName") ?? ""),
      newFlockBatchReference: String(form.get("batchReference") ?? ""),
      newFlockBreed: String(form.get("flockBreed") ?? ""),
      newFlockHousePen: String(form.get("housePen") ?? ""),
      newFlockAgeWeeks: String(form.get("ageWeeks") ?? ""),
      notes: String(form.get("notes") ?? ""),
      costReviewed: form.get("costReviewed") === "on",
    };
    const fingerprint = JSON.stringify(request);
    const requestKey = idempotencyFingerprint === fingerprint && idempotencyKey
      ? idempotencyKey
      : crypto.randomUUID();
    setIdempotencyKey(requestKey);
    setIdempotencyFingerprint(fingerprint);
    startTransition(async () => {
      const result = await postRearingTransferAction(batchId, { ...request, idempotencyKey: requestKey });
      setMessage(result.message);
      if (result.ok && result.nextPath) router.push(result.nextPath);
      else if (!result.ok) {
        const updated = await getRearingTransferPreviewAction(batchId, date);
        if (updated.ok) setPreview({ availableBirds: updated.availableBirds, remainingCost: updated.remainingCost, costComplete: updated.costComplete });
      }
    });
  }

  return <form onSubmit={submit} className="space-y-6">
    <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
      <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-lime-100 text-emerald-800"><Bird size={21}/></span><div><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Source rearing batch</p><p className="font-semibold">{batchCode} · {breed}</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="Available on selected date" value={available.toLocaleString()}/><Metric label="Remaining rearing cost" value={money(preview.remainingCost,currency)}/><Metric label="Cost history" value={preview.costComplete ? "Feed cost recorded" : "Needs reconciliation"}/></div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2">
      <label className={label}>Transfer date<Input type="date" name="transferDate" min={arrivalDate} max={today} value={date} onChange={e => setDate(e.target.value)} required className="mt-2"/></label>
      <label className={label}>Birds to transfer<Input type="number" name="quantity" min="1" max={available} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required className="mt-2" placeholder="Whole birds only"/></label>
    </section>

    <section className="rounded-2xl border border-stone-200 p-4 sm:p-5">
      <h2 className="font-semibold">Destination layer flock</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        {flocks.map(f => <label key={f.id} className={`flex min-h-12 flex-1 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${destination===f.id?"border-emerald-700 bg-emerald-50":"border-stone-200"}`}>
          <input type="radio" name="destinationChoice" checked={destination===f.id} onChange={() => setDestination(f.id)} aria-label={`Transfer into ${f.flock_name}`}/>
          <span className="min-w-0"><b className="block truncate">{f.flock_name}</b><small className="text-stone-600">{f.current_live_birds.toLocaleString()} birds · {f.breed||"Breed not set"}{f.house_pen?` · ${f.house_pen}`:""}</small></span>
        </label>)}
        <label className={`flex min-h-12 flex-1 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${destination==="new"?"border-emerald-700 bg-emerald-50":"border-stone-200"}`}>
          <input type="radio" name="destinationChoice" checked={destination==="new"} onChange={() => setDestination("new")}/><span><b className="block">Create a new flock</b><small className="text-stone-600">Transferred birds establish its population.</small></span>
        </label>
      </div>
      {destination==="new"&&<div className="mt-4 grid gap-4 border-t border-stone-100 pt-4 sm:grid-cols-2">
        <label className={label}>Flock name<Input name="flockName" minLength={2} maxLength={120} required className="mt-2" placeholder="e.g. Layers A"/></label>
        <label className={label}>Flock / batch reference<Input name="batchReference" maxLength={120} className="mt-2" placeholder="Optional"/></label>
        <label className={label}>Breed / strain<Input name="flockBreed" maxLength={120} className="mt-2" defaultValue={breed}/></label>
        <label className={label}>House / pen<Input name="housePen" maxLength={120} className="mt-2" placeholder="Optional"/></label>
        <label className={label}>Age at arrival (weeks)<Input name="ageWeeks" type="number" min="0" max="200" step="1" className="mt-2" placeholder="Optional"/></label>
        <p className="self-end text-sm text-stone-500">Flock starts on {date}; incoming birds are posted once as the transfer movement.</p>
      </div>}
    </section>

    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5" aria-live="polite">
      <h2 className="font-semibold">Transfer preview</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Metric label="Birds moved" value={validQty?qty.toLocaleString():"Enter a valid whole number"}/><Metric label="Cost basis moved" value={validQty?money(transferredCost,currency):"—"}/><Metric label="Unit cost snapshot" value={validQty?`${money(unitCost,currency)} per bird`:"—"}/><Metric label="Remaining rearing birds" value={validQty?Math.max(0,available-qty).toLocaleString():"—"}/><Metric label="Remaining rearing cost" value={validQty?money(Math.max(0,preview.remainingCost-transferredCost),currency):money(preview.remainingCost,currency)}/></div>
      <p className="mt-3 text-xs leading-5 text-stone-600">Cost is allocated from eligible source costs through the selected date. A final transfer moves the entire remaining cost, including rounding residuals. This is a management cost basis—not cash, a new expense, or a general-ledger asset.</p>
    </section>

    {!preview.costComplete&&<p role="alert" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><CircleAlert size={18} className="mt-0.5 shrink-0"/>At least one active feed-consumption row has no cost snapshot. Reconcile the feed cost history before transferring.</p>}
    <label className="flex items-start gap-3 rounded-xl border border-stone-200 p-4 text-sm"><input type="checkbox" name="costReviewed" required className="mt-1 size-4 accent-emerald-700"/><span><b>I reviewed the batch costs through this date.</b><span className="mt-1 block text-stone-600">I confirm the recorded costs are complete, or that no additional costs were incurred. The server recalculates and snapshots the amount when I confirm.</span></span></label>
    <label className={label}>Notes (optional)<textarea name="notes" maxLength={2000} className={areaClass}/></label>
    {message&&<p role="status" className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{message}</p>}
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={() => router.push(`/rearing/${batchId}`)}>Cancel</Button><Button disabled={pending||previewPending||!validQty||!preview.costComplete||available<=0} className="gap-2">{pending?"Posting transfer…":previewPending?"Refreshing preview…":"Confirm point-of-lay transfer"}<ArrowRight size={17}/></Button></div>
  </form>;
}

export function ReverseRearingTransferForm({ transferId }: { transferId: string }) {
  const router = useRouter(); const [pending,startTransition]=useTransition(); const [message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const reason=String(new FormData(event.currentTarget).get("reason")??"");startTransition(async()=>{const result=await reverseRearingTransferAction(transferId,reason);setMessage(result.message);if(result.ok)router.refresh();});}
  return <form onSubmit={submit} className="mt-5 space-y-3"><label className={label}>Reason for reversal<textarea name="reason" minLength={3} maxLength={500} required className={areaClass}/></label>{message&&<p role="status" className="text-sm text-stone-700">{message}</p>}<Button disabled={pending} variant="secondary" className="border-red-200 text-red-800">{pending?"Checking and reversing…":"Reverse transfer"}</Button></form>;
}

function Metric({ label: title, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/75 p-3"><p className="text-xs text-stone-500">{title}</p><p className="mt-1 break-words font-semibold tabular-nums">{value}</p></div>; }
