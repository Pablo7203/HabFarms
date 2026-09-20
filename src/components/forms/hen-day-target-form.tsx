"use client";

import { useState, useTransition } from "react";
import { saveHenDayTargetAction } from "@/app/actions/operations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function HenDayTargetForm({ flockId, today }: { flockId: string; today: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return <form className="mt-4 space-y-3" onSubmit={(event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => { const result = await saveHenDayTargetAction(flockId, { targetPercentage: form.get("targetPercentage"), effectiveFrom: form.get("effectiveFrom"), notes: form.get("notes") }); setMessage(result.message); if (result.ok) event.currentTarget.reset(); });
  }}>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Target Hen-Day %<Input name="targetPercentage" type="number" min="0.01" max="100" step="0.01" required className="mt-1" placeholder="e.g. 85"/></label><label className="text-sm font-semibold">Effective from<Input name="effectiveFrom" type="date" defaultValue={today} required className="mt-1"/></label></div>
    <label className="block text-sm font-semibold">Reason or note <span className="font-normal text-stone-500">(optional)</span><textarea name="notes" className="mt-1 min-h-20 w-full rounded-xl border border-stone-300 p-3"/></label>
    {message && <p role="status" className="rounded-xl bg-stone-50 p-3 text-sm text-stone-700">{message}</p>}
    <Button disabled={pending}>{pending ? "Saving target…" : "Save production target"}</Button>
  </form>;
}
