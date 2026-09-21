"use client";

import { FormEvent, useState, useTransition } from "react";
import { createSubscriptionPlanAction, updateSubscriptionPlanAction } from "@/app/actions/platform-billing";

export type PlatformPlan = { id: string; code: string; name: string; description: string | null; currency: string; monthly_price: number | string | null; annual_price: number | string | null; default_trial_days: number; default_grace_days: number; max_users: number | null; is_active: boolean };

const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100";

function numberValue(value: FormDataEntryValue | null) { return value === null || value === "" ? null : Number(value); }

export function PlatformPlanForm({ plan, onDone }: { plan?: PlatformPlan; onDone?: () => void }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const isNew = !plan;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = {
      id: plan?.id,
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      currency: String(form.get("currency") ?? "GHS"),
      monthlyPrice: numberValue(form.get("monthlyPrice")),
      annualPrice: numberValue(form.get("annualPrice")),
      trialDays: Number(form.get("trialDays")),
      graceDays: Number(form.get("graceDays")),
      maxUsers: numberValue(form.get("maxUsers")),
      isActive: form.get("isActive") === "on",
    };
    startTransition(async () => {
      const result = isNew ? await createSubscriptionPlanAction(input) : await updateSubscriptionPlanAction(input);
      setMessage(result.message);
      if (result.ok) { formElement.reset(); onDone?.(); }
    });
  };
  return <form onSubmit={submit} className="grid gap-4 text-sm sm:grid-cols-2">
    {isNew && <label className="font-medium">Stable code<input name="code" required maxLength={40} placeholder="STANDARD" className={inputClass} /></label>}
    <label className="font-medium">Plan name<input name="name" required defaultValue={plan?.name} className={inputClass} /></label>
    <label className="font-medium">Currency<input name="currency" required defaultValue={plan?.currency ?? "GHS"} maxLength={3} className={inputClass} /></label>
    <label className="font-medium">Monthly price<input name="monthlyPrice" required type="number" min="0" step="0.01" defaultValue={plan?.monthly_price ?? ""} className={inputClass} /></label>
    <label className="font-medium">Annual price<input name="annualPrice" required type="number" min="0" step="0.01" defaultValue={plan?.annual_price ?? ""} className={inputClass} /></label>
    <label className="font-medium">Default trial days<input name="trialDays" required type="number" min="0" max="365" defaultValue={plan?.default_trial_days ?? 14} className={inputClass} /></label>
    <label className="font-medium">Default grace days<input name="graceDays" required type="number" min="0" max="365" defaultValue={plan?.default_grace_days ?? 0} className={inputClass} /></label>
    <label className="font-medium">Maximum users <span className="font-normal text-stone-500">optional</span><input name="maxUsers" type="number" min="1" defaultValue={plan?.max_users ?? ""} className={inputClass} /></label>
    <label className="sm:col-span-2 font-medium">Description <span className="font-normal text-stone-500">optional</span><textarea name="description" defaultValue={plan?.description ?? ""} rows={3} className={`${inputClass} py-3`} /></label>
    <label className="flex min-h-11 items-center gap-2 font-medium sm:col-span-2"><input name="isActive" type="checkbox" defaultChecked={plan?.is_active ?? true} /> Available for new customers</label>
    {message && <p role="status" className="sm:col-span-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-700">{message}</p>}
    <button disabled={pending} className="min-h-11 rounded-xl bg-emerald-800 px-4 font-semibold text-white transition hover:bg-emerald-900 disabled:opacity-60 sm:col-span-2">{pending ? "Saving…" : isNew ? "Create plan" : "Save plan"}</button>
  </form>;
}

export function PlatformPlanEditor({ plan }: { plan: PlatformPlan }) {
  const [open, setOpen] = useState(false);
  return <div className="mt-5 border-t border-stone-200 pt-4"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">{open ? "Close editor" : "Edit plan"}</button>{open && <div className="mt-4 rounded-2xl bg-stone-50 p-4"><PlatformPlanForm plan={plan} onDone={() => setOpen(false)} /></div>}</div>;
}
