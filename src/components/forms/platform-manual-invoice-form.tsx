"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createManualInvoiceAction, voidManualInvoiceAction } from "@/app/actions/platform-billing";

type Customer = { farm_id: string; farm_name: string; owner_name: string; owner_email: string; currency: string | null };

export function PlatformManualInvoiceForm({ customer, defaultCurrency }: { customer: Customer; defaultCurrency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const defaultDueDate = new Date(`${today}T12:00:00Z`);
  defaultDueDate.setUTCDate(defaultDueDate.getUTCDate() + 30);
  const dueDate = defaultDueDate.toISOString().slice(0, 10);

  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createManualInvoiceAction({
        farmId: customer.farm_id,
        description: form.get("description"),
        amount: form.get("amount"),
        currency: form.get("currency"),
        invoiceDate: form.get("invoiceDate"),
        dueDate: form.get("dueDate"),
      });
      setMessage(result.message);
      if (result.ok && result.invoiceId) router.push(`/platform/invoices/manual/${result.invoiceId}`);
    });
  }}>
    <div className="rounded-xl bg-stone-50 p-4 text-sm"><p className="font-semibold">{customer.farm_name}</p><p className="mt-1 text-stone-600">{customer.owner_name} · {customer.owner_email}</p></div>
    <label className="block text-sm font-medium">Invoice description<textarea name="description" required minLength={3} maxLength={500} className="mt-2 min-h-28 w-full rounded-xl border px-3 py-2" placeholder="For example: One-time onboarding and data migration service" /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Amount<input name="amount" type="number" min="0.01" step="0.01" required className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label>
      <label className="text-sm font-medium">Currency<input name="currency" defaultValue={customer.currency ?? defaultCurrency} required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" className="mt-2 min-h-11 w-full rounded-xl border px-3 uppercase" /><span className="mt-1 block text-xs font-normal text-stone-500">Use the three-letter currency code agreed with the customer.</span></label>
      <label className="text-sm font-medium">Invoice date<input name="invoiceDate" type="date" defaultValue={today} required className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label>
      <label className="text-sm font-medium">Due date<input name="dueDate" type="date" defaultValue={dueDate} required className="mt-2 min-h-11 w-full rounded-xl border px-3" /></label>
    </div>
    {message && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Issuing this invoice does not record a payment, subscription charge, or expense in the customer’s farm books. Confirm tax treatment and payment instructions separately before sending.</p>
    <button disabled={pending} className="min-h-11 rounded-xl bg-emerald-900 px-4 font-semibold text-white disabled:opacity-60">{pending ? "Issuing invoice…" : "Issue manual invoice"}</button>
  </form>;
}

export function PlatformManualInvoiceVoidForm({ invoiceId }: { invoiceId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return <form className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => setMessage((await voidManualInvoiceAction({ invoiceId, reason: form.get("reason") })).message));
  }}>
    <label className="block text-sm font-semibold text-red-950">Void this invoice<textarea name="reason" required minLength={3} maxLength={500} className="mt-2 min-h-20 w-full rounded-lg border border-red-200 bg-white p-3 font-normal" placeholder="Explain why this invoice must be voided." /></label>
    {message && <p role="status" className="mt-2 text-sm text-red-900">{message}</p>}
    <button disabled={pending} className="mt-3 min-h-10 rounded-lg border border-red-300 bg-white px-3 text-sm font-semibold text-red-800 disabled:opacity-60">{pending ? "Voiding…" : "Void invoice"}</button>
  </form>;
}
