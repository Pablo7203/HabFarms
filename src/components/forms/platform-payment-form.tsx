"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareSubscriptionBillingPeriodAction, recordSubscriptionPaymentAction, voidSubscriptionPaymentAction } from "@/app/actions/platform-billing";
import { money } from "@/lib/format";

export function PlatformPaymentForm({ periodId, farmName, periodLabel, outstanding, currency }: { periodId: string; farmName: string; periodLabel: string; outstanding: number; currency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget, form = new FormData(formElement), amount = Number(form.get("amount"));
    if (amount > outstanding) { setMessage(`The maximum payment for this period is ${money(outstanding, currency)}.`); return; }
    if (!window.confirm(`Record ${money(amount, currency)} for ${farmName}?\n\nPeriod: ${periodLabel}\nOutstanding after payment: ${money(Math.max(outstanding - amount, 0), currency)}`)) return;
    const input = { periodId, amount, method: String(form.get("method")), reference: String(form.get("reference") ?? ""), paidAt: String(form.get("paidAt")), notes: String(form.get("notes") ?? ""), idempotencyKey: crypto.randomUUID() };
    startTransition(async () => { const result = await recordSubscriptionPaymentAction(input); setMessage(result.message); if (result.ok) { formElement.reset(); router.refresh(); } });
  };
  return <form onSubmit={submit} className="grid gap-3 text-sm sm:grid-cols-2"><label className="font-medium">Payment amount<input required name="amount" type="number" min="0.01" max={outstanding} step="0.01" className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label><label className="font-medium">Payment date<input required name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label><label className="font-medium">Method<select required name="method" defaultValue="momo" className="mt-1 min-h-11 w-full rounded-xl border bg-white px-3"><option value="momo">MoMo</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="paystack_manual">Paystack reference</option><option value="other">Other</option></select></label><label className="font-medium">Reference <span className="font-normal text-stone-500">optional for cash</span><input name="reference" maxLength={160} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label><label className="font-medium sm:col-span-2">Notes <span className="font-normal text-stone-500">optional</span><textarea name="notes" rows={2} className="mt-1 w-full rounded-xl border px-3 py-2" /></label>{message && <p role="status" className="sm:col-span-2 rounded-xl bg-stone-50 p-3 text-stone-700">{message}</p>}<button disabled={pending} className="min-h-11 rounded-xl bg-emerald-800 px-4 font-semibold text-white disabled:opacity-60 sm:col-span-2">{pending ? "Recording…" : "Confirm and record payment"}</button></form>;
}

export function PrepareBillingPeriodButton({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <div className="mt-4"><button type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await prepareSubscriptionBillingPeriodAction({ subscriptionId }); setMessage(result.message); if (result.ok) router.refresh(); })} className="min-h-11 rounded-xl bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Preparing…" : "Prepare billing period"}</button>{message && <p role="status" className="mt-3 rounded-xl bg-stone-50 p-3 text-sm text-stone-700">{message}</p>}</div>;
}

export function VoidSubscriptionPaymentButton({ paymentId, subscriptionId }: { paymentId: string; subscriptionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const voidPayment = () => {
    const reason = window.prompt("Why is this payment being voided? This restores the billing balance.");
    if (!reason) return;
    if (!window.confirm("Void this payment? This cannot be undone.")) return;
    startTransition(async () => { const result = await voidSubscriptionPaymentAction({ paymentId, subscriptionId, reason }); setMessage(result.message); if (result.ok) router.refresh(); });
  };
  return <div className="inline-block"><button type="button" disabled={pending} onClick={voidPayment} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">{pending ? "Voiding…" : "Void"}</button>{message && <p role="status" className="mt-2 max-w-xs text-xs text-stone-600">{message}</p>}</div>;
}
