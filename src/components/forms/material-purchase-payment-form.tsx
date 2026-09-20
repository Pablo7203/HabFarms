"use client";

import { useState, useTransition } from "react";
import { recordMaterialPurchasePaymentAction } from "@/app/actions/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MaterialPurchasePaymentForm({ purchaseId, maxAmount, today }: { purchaseId: string; maxAmount: number; today: string }) {
  const [open, setOpen] = useState(false); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState("");
  if (!open) return <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Record payment</Button>;
  return <form className="mt-3 grid gap-2 rounded-xl bg-stone-50 p-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => { const result = await recordMaterialPurchasePaymentAction(purchaseId, { paymentDate: form.get("paymentDate"), amount: form.get("amount"), paymentMethod: form.get("paymentMethod"), reference: form.get("reference"), notes: "" }); setMessage(result.message); if (result.ok) setOpen(false); }); }}><Input name="paymentDate" type="date" defaultValue={today} required/><Input name="amount" type="number" min="0.01" max={maxAmount} step="0.01" placeholder="Amount paid" required/><select name="paymentMethod" className="min-h-11 rounded-xl border border-stone-300 px-3"><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select><Input name="reference" placeholder="Reference (optional)"/><div className="flex gap-2"><Button disabled={pending}>{pending ? "Saving…" : "Save payment"}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>{message && <p role="status" className="text-sm text-stone-600">{message}</p>}</form>;
}
