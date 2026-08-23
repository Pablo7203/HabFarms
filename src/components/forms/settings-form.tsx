"use client";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { updateFarmSettingsAction } from "@/app/actions/farm";
import { farmSettingsSchema } from "@/lib/validation/farm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Values = z.input<typeof farmSettingsSchema>;
export function SettingsForm({ defaults }: { defaults: Values }) {
  const [pending, startTransition] = useTransition(); const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({ resolver: zodResolver(farmSettingsSchema), defaultValues: defaults });
  const field = (name: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label className="block text-sm font-medium text-stone-800">{label}<Input className="mt-2" {...props} {...register(name)} />{errors[name] && <span className="mt-1 block text-sm text-red-700">{String(errors[name]?.message)}</span>}</label>;
  return <form onSubmit={handleSubmit((values) => startTransition(async () => { const result = await updateFarmSettingsAction(values); setStatus({ ok: result.ok, text: result.message }); }))} className="space-y-8">
    <section><h2 className="text-lg font-semibold">Farm</h2><p className="mt-1 text-sm text-stone-500">Identity, presentation units, and financial opening position.</p><div className="mt-5 grid gap-5 sm:grid-cols-2">{field("name", "Farm name")}{field("currency", "Currency", { maxLength: 3 })}{field("timezone", "Timezone")}{field("crateSize", "Eggs per crate", { type: "number", min: 1, step: 1 })}{field("feedBagSizeKg", "Feed bag size (kg)", { type: "number", min: 0.01, step: "0.01" })}{field("openingCashBalance", "Opening cash balance", { type: "number", min: 0, step: "0.01" })}</div></section>
    <hr className="border-stone-200" /><section><h2 className="text-lg font-semibold">Operational defaults</h2><p className="mt-1 text-sm text-stone-500">Starting values used when future records are entered.</p><div className="mt-5 grid gap-5 sm:grid-cols-2">{field("defaultEggPricePerCrate", "Default price per crate", { type: "number", min: 0, step: "0.01" })}{field("defaultLooseEggPrice", "Default loose egg price", { type: "number", min: 0, step: "0.01" })}{field("feedAlertWarningDays", "Feed warning threshold (days)", { type: "number", min: 0, step: 1 })}{field("feedAlertCriticalDays", "Feed critical threshold (days)", { type: "number", min: 0, step: 1 })}{field("averageFeedDaysWindow", "Feed averaging window (days)", { type: "number", min: 1, step: 1 })}</div></section>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Default prices and configuration values are used for future transactions. Updating them will not change historical records.</div>
    {status && <p role="status" className={`rounded-lg p-3 text-sm ${status.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{status.text}</p>}<Button disabled={pending}>{pending ? "Saving..." : "Save settings"}</Button>
  </form>;
}
