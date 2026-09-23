"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  correctRearingFeedAction, createRearingCostExpenseAction, createRearingHealthAction,
  createRearingHealthReminderAction, recordRearingFeedAction, saveRearingFeedPlanAction,
} from "@/app/actions/rearing-phase2";
import { uploadPurchaseReceiptAction } from "@/app/actions/feed";

type Option = { id: string; name: string };
type Message = { ok: boolean; message: string; id?: string };
function useSubmit<T>(run: (form: FormData) => Promise<T>) {
  const [pending, start] = useTransition(), [message, setMessage] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMessage(""); const form = e.currentTarget, data = new FormData(form);
    start(async () => { const result = await run(data) as Message; setMessage(result.message); if (result.ok) form.reset(); });
  }
  return { pending, message, submit };
}
const field = "block text-sm font-semibold text-stone-700";
const select = "mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const textarea = "mt-2 min-h-20 w-full rounded-lg border border-stone-300 bg-white p-3 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
function Feedback({ message }: { message: string }) {
  return <>{message && <p role="status" className="sm:col-span-2 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{message}</p>}</>;
}

export function RearingFeedConsumptionForm({ batchId, today, arrivalDate, feedTypes, dailyRecordId, date = today }: {
  batchId: string; today: string; arrivalDate: string; date?: string; feedTypes: Option[]; dailyRecordId?: string;
}) {
  const router = useRouter();
  const form = useSubmit(async (f) => {
    const result = await recordRearingFeedAction(batchId, { feedTypeId: f.get("feedTypeId"), consumptionDate: f.get("date"), quantityKg: f.get("quantityKg"), dailyRecordId: dailyRecordId ?? "", notes: f.get("notes") });
    if (result.ok) router.refresh(); return result;
  });
  return <form onSubmit={form.submit} className="grid gap-4 sm:grid-cols-2">
    <label className={field}>Feed product<select required name="feedTypeId" defaultValue="" className={select}><option value="" disabled>Select feed</option>{feedTypes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className={field}>Consumed (kg)<Input name="quantityKg" type="number" min="0.001" step="0.001" required className="mt-2" placeholder="e.g. 32.5"/></label>
    <label className={field}>Consumption date<Input name="date" type="date" min={arrivalDate} max={today} defaultValue={date} required readOnly={!!dailyRecordId} className="mt-2 read-only:bg-stone-50"/></label>
    <label className={`${field} sm:col-span-2`}>Notes<textarea name="notes" maxLength={2000} className={textarea}/></label>
    <p className="sm:col-span-2 text-xs leading-5 text-stone-500">This posts kg to the shared farm feed inventory and snapshots the existing weighted-average cost. Feed purchase cost and payment are not counted again here.</p>
    <Feedback message={form.message}/><Button disabled={form.pending || !feedTypes.length} className="sm:col-span-2">{form.pending ? "Posting…" : "Record feed consumption"}</Button>
  </form>;
}

export function RearingFeedCorrectionForm({ batchId, consumption, feedTypes, today }: { batchId: string; consumption: { id: string; feed_type_id: string; consumption_date: string; quantity_kg: number }; feedTypes: Option[]; today: string }) {
  const router = useRouter();
  const form = useSubmit(async (f) => {
    const result = await correctRearingFeedAction(batchId, consumption.id, { feedTypeId: f.get("feedTypeId"), consumptionDate: f.get("date"), quantityKg: f.get("quantityKg"), reason: f.get("reason"), notes: f.get("notes") });
    if (result.ok) router.refresh(); return result;
  });
  return <form onSubmit={form.submit} className="mt-3 grid gap-2 rounded-xl bg-stone-50 p-3 sm:grid-cols-2">
    <label className={field}>Replacement feed<select name="feedTypeId" defaultValue={consumption.feed_type_id} className={select}>{feedTypes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className={field}>Correct kg<Input name="quantityKg" type="number" min="0.001" step="0.001" required defaultValue={consumption.quantity_kg} className="mt-2"/></label>
    <label className={field}>Date<Input name="date" type="date" min={consumption.consumption_date} max={today} defaultValue={consumption.consumption_date} required className="mt-2"/></label>
    <label className={field}>Correction reason<Input name="reason" minLength={3} maxLength={500} required className="mt-2" placeholder="Explain the correction"/></label>
    <label className={`${field} sm:col-span-2`}>Notes<textarea name="notes" className={textarea}/></label>
    <Feedback message={form.message}/><Button disabled={form.pending} className="sm:col-span-2">{form.pending ? "Correcting…" : "Post audited correction"}</Button>
  </form>;
}

export function RearingFeedPlanForm({ batchId, today, feedTypes, stage }: { batchId: string; today: string; feedTypes: Option[]; stage: string }) {
  const router = useRouter();
  const form = useSubmit(async f => { const r = await saveRearingFeedPlanAction(batchId, { feedTypeId: f.get("feedTypeId"), feedingStage: f.get("stage"), gramsPerBirdPerDay: f.get("grams"), effectiveFrom: f.get("date"), notes: f.get("notes") }); if (r.ok) router.refresh(); return r; });
  return <form onSubmit={form.submit} className="grid gap-4 sm:grid-cols-2">
    <label className={field}>Feed product<select name="feedTypeId" defaultValue="" required className={select}><option value="" disabled>Select feed</option>{feedTypes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className={field}>Stage name<Input name="stage" defaultValue={stage} minLength={2} maxLength={60} required className="mt-2"/></label>
    <label className={field}>Target (g per bird / day)<Input name="grams" type="number" min="0.001" max="1000" step="0.001" required className="mt-2" placeholder="Farm-configured target"/></label>
    <label className={field}>Effective from<Input name="date" type="date" defaultValue={today} required className="mt-2"/></label>
    <label className={`${field} sm:col-span-2`}>Notes<textarea name="notes" className={textarea}/></label>
    <p className="sm:col-span-2 text-xs text-stone-500">Targets are farm-configured planning values, not universal poultry standards. Saving a plan does not post feed inventory movements.</p>
    <Feedback message={form.message}/><Button disabled={form.pending || !feedTypes.length} className="sm:col-span-2">{form.pending ? "Saving…" : "Save feed target"}</Button>
  </form>;
}

export function RearingHealthForm({ batchId, today, financial }: { batchId: string; today: string; financial: boolean }) {
  const router = useRouter();
  const form = useSubmit(async f => { const r = await createRearingHealthAction(batchId, { recordDate: f.get("date"), healthType: f.get("type"), productName: f.get("product"), reason: f.get("reason"), dose: f.get("dose"), route: f.get("route"), duration: f.get("duration"), quantity: f.get("quantity"), quantityUnit: f.get("unit"), veterinaryProvider: f.get("provider"), cost: financial ? f.get("cost") : 0, nextDueDate: f.get("due"), notes: f.get("notes"), initialPayment: financial ? f.get("paid") : 0, paymentMethod: f.get("method") ?? "cash", reference: f.get("reference") }); if (r.ok) router.refresh(); return r; });
  return <form onSubmit={form.submit} className="grid gap-4 sm:grid-cols-2">
    <label className={field}>Date<Input name="date" type="date" defaultValue={today} max={today} required className="mt-2"/></label>
    <label className={field}>Activity type<select name="type" className={select}>{["vaccine", "antibiotic", "vitamin", "dewormer", "treatment", "veterinary_service", "other"].map(x => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select></label>
    <label className={field}>Product / service<Input name="product" required minLength={2} maxLength={160} className="mt-2"/></label>
    <label className={field}>Reason<Input name="reason" className="mt-2"/></label>
    <label className={field}>Dose<Input name="dose" className="mt-2"/></label><label className={field}>Route<Input name="route" className="mt-2"/></label>
    <label className={field}>Duration<Input name="duration" className="mt-2" placeholder="Optional"/></label>
    <label className={field}>Quantity<Input name="quantity" type="number" min="0" step="0.001" className="mt-2"/></label><label className={field}>Unit<Input name="unit" className="mt-2" placeholder="ml, dose, vial…"/></label>
    <label className={field}>Administered by / provider<Input name="provider" className="mt-2"/></label><label className={field}>Next due date<input name="due" type="date" className={select}/></label>
    {financial && <><label className={field}>Associated cost<Input name="cost" type="number" min="0" step="0.01" defaultValue="0" className="mt-2"/></label><label className={field}>Paid now<Input name="paid" type="number" min="0" step="0.01" defaultValue="0" className="mt-2"/></label>
      <label className={field}>Payment method<select name="method" className={select}>{[["cash", "Cash"], ["momo", "Mobile money"], ["bank_transfer", "Bank transfer"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className={field}>Payment reference<Input name="reference" className="mt-2"/></label></>}
    <label className={`${field} sm:col-span-2`}>Notes<textarea name="notes" className={textarea}/></label>
    {financial&&<p className="sm:col-span-2 text-xs text-stone-500">Associated health cost is represented once by its linked expense; any payment is recorded separately. HabFarms has no medicine-stock ledger to deduct from here.</p>}
    <Feedback message={form.message}/><Button disabled={form.pending} className="sm:col-span-2">{form.pending ? "Saving…" : "Record health activity"}</Button>
  </form>;
}

export function RearingHealthReminderForm({ batchId, today }: { batchId: string; today: string }) {
  const router = useRouter();
  const form = useSubmit(async f => { const r = await createRearingHealthReminderAction(batchId, { activityType: f.get("type"), title: f.get("title"), dueDate: f.get("date"), notes: f.get("notes") }); if (r.ok) router.refresh(); return r; });
  return <form onSubmit={form.submit} className="grid gap-3 sm:grid-cols-2">
    <label className={field}>Activity<select name="type" className={select}>{["vaccination", "treatment_follow_up", "medication", "inspection", "other"].map(x => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select></label>
    <label className={field}>Title<Input name="title" required minLength={2} maxLength={160} className="mt-2"/></label>
    <label className={field}>Due date<Input name="date" type="date" min={today} defaultValue={today} required className="mt-2"/></label>
    <label className={field}>Notes<Input name="notes" className="mt-2"/></label>
    <Feedback message={form.message}/><Button disabled={form.pending} className="sm:col-span-2">{form.pending ? "Scheduling…" : "Schedule activity"}</Button>
  </form>;
}

export function RearingCostExpenseForm({ batchId, today, categories, suppliers, acquisitionExists }: {
  batchId: string; today: string; categories: Option[]; suppliers: Option[]; acquisitionExists: boolean;
}) {
  const router = useRouter(), [receipt, setReceipt] = useState<File | null>(null);
  const form = useSubmit(async f => {
    const created = await createRearingCostExpenseAction(batchId, { costKind: f.get("kind"), expenseDate: f.get("date"), categoryId: f.get("category"), description: f.get("description"), supplierId: f.get("supplier"), payeeName: f.get("payee"), amount: f.get("amount"), initialPayment: f.get("paid"), paymentMethod: f.get("method"), reference: f.get("reference"), notes: f.get("notes") });
    if (!created.ok || !created.id) return created;
    let message = created.message;
    if (receipt) { const evidence = new FormData(); evidence.set("receipt", receipt); const upload = await uploadPurchaseReceiptAction("expense", created.id, evidence); message = upload.ok ? `${message} Receipt evidence attached.` : `${message} The expense is saved, but the receipt upload failed: ${upload.message}`; }
    setReceipt(null); router.refresh(); return { ok: true, message };
  });
  return <form onSubmit={form.submit} className="grid gap-4 sm:grid-cols-2">
    <label className={field}>Cost category<select name="kind" defaultValue="other_direct" className={select}><option value="other_direct">Other direct rearing cost</option><option value="acquisition" disabled={acquisitionExists}>DOC acquisition {acquisitionExists ? "(already recorded)" : ""}</option></select></label>
    <label className={field}>Date<Input name="date" type="date" defaultValue={today} max={today} required className="mt-2"/></label>
    <label className={field}>Expense category<select name="category" defaultValue="" required className={select}><option value="" disabled>Select category</option>{categories.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className={field}>Description<Input name="description" required minLength={2} maxLength={300} className="mt-2" placeholder="DOC purchase, brooder fuel…"/></label>
    <label className={field}>Supplier<select name="supplier" defaultValue="" className={select}><option value="">No supplier / market purchase</option>{suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className={field}>Other payee name<Input name="payee" className="mt-2"/></label>
    <label className={field}>Total cost<Input name="amount" type="number" min="0.01" step="0.01" required className="mt-2"/></label>
    <label className={field}>Paid now<Input name="paid" type="number" min="0" step="0.01" defaultValue="0" required className="mt-2"/></label>
    <label className={field}>Payment method<select name="method" className={select}>{[["cash", "Cash"], ["momo", "Mobile money"], ["bank_transfer", "Bank transfer"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <label className={field}>Reference<Input name="reference" className="mt-2"/></label>
    <label className={`${field} sm:col-span-2`}>Receipt evidence <span className="font-normal text-stone-500">(optional; cash or bank payments)</span>
      <span className="mt-2 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 text-sm font-normal text-stone-600 hover:border-emerald-400 hover:bg-emerald-50"><span className="grid size-8 place-items-center rounded-lg bg-white text-emerald-700"><ImageUp size={17}/></span><span><b className="block text-stone-800">{receipt?.name ?? "Upload receipt image"}</b><span className="text-xs">Any image type · max 10 MB</span></span><input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={e => setReceipt(e.target.files?.[0] ?? null)}/></span>
    </label>
    <label className={`${field} sm:col-span-2`}>Notes<textarea name="notes" className={textarea}/></label>
    <p className="sm:col-span-2 text-xs leading-5 text-stone-500">Creates one existing expense and (if supplied) expense-payment record. No duplicate payable or cash ledger is created.</p>
    <Feedback message={form.message}/><Button disabled={form.pending || !categories.length}>{form.pending ? "Saving…" : "Record batch cost"}</Button>
  </form>;
}
