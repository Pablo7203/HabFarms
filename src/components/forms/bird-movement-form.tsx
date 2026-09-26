"use client";

import { useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBirdMovementAction } from "@/app/actions/operations";
import { birdMovementSchema } from "@/lib/validation/operations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MovementType = "addition" | "death" | "cull" | "bird_sale" | "transfer_in" | "transfer_out" | "adjustment";
type Values = {
  flockId: string;
  movementDate: string;
  movementType: MovementType;
  quantity: number | string;
  direction: "IN" | "OUT";
  notes: string;
};

export function BirdMovementForm({ flockId, today, currentLiveBirds }: { flockId: string; today: string; currentLiveBirds: number }) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(birdMovementSchema) as unknown as Resolver<Values>,
    defaultValues: { flockId, movementDate: today, movementType: "death", direction: "OUT", notes: "" },
  });
  const type = watch("movementType");
  const movementDate = watch("movementDate");
  const direction = watch("direction");
  const quantity = Number(watch("quantity") || 0);
  const availableToday = Math.max(currentLiveBirds, 0);
  const exceedsToday = movementDate === today && direction === "OUT" && quantity > availableToday;
  const typeRegistration = register("movementType");

  const syncDirection = (nextType: MovementType) => {
    if (["addition", "transfer_in"].includes(nextType)) setValue("direction", "IN");
    else if (nextType !== "adjustment") setValue("direction", "OUT");
  };

  const submit = handleSubmit((values) => {
    if (values.movementDate === today && values.direction === "OUT" && Number(values.quantity) > availableToday) {
      setStatus({ ok: false, text: `You can decrease by at most ${availableToday.toLocaleString()} birds today.` });
      return;
    }
    start(async () => {
      const result = await createBirdMovementAction(values);
      setStatus({ ok: result.ok, text: result.message });
      if (result.ok) reset({ ...values, quantity: "", notes: "" });
    });
  });

  return (
    <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={submit}>
      <input type="hidden" {...register("flockId")} />
      <label className="text-sm font-medium">Date<Input className="mt-2" type="date" {...register("movementDate")} /></label>
      <label className="text-sm font-medium">
        Movement type
        <select className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3" {...typeRegistration} onChange={(event) => { typeRegistration.onChange(event); syncDirection(event.target.value as MovementType); }}>
          <option value="addition">Addition</option><option value="death">Death</option><option value="cull">Cull</option><option value="bird_sale">Bird sale</option><option value="transfer_in">Transfer in</option><option value="transfer_out">Transfer out</option><option value="adjustment">Adjustment</option>
        </select>
      </label>
      <label className="text-sm font-medium">
        Quantity
        <Input className="mt-2" type="number" min="1" max={movementDate === today && direction === "OUT" ? availableToday : undefined} inputMode="numeric" aria-describedby="bird-movement-quantity-help" {...register("quantity")} />
        <span id="bird-movement-quantity-help" className={`mt-1 block text-xs font-normal ${exceedsToday ? "text-red-700" : "text-stone-500"}`} aria-live="polite">
          {direction === "OUT" ? movementDate === today ? `Available live birds today: ${availableToday.toLocaleString()}. A decrease cannot exceed this count.` : "A historical decrease is checked against the live birds available on the selected date." : "Additions increase the flock’s live-bird balance."}
        </span>
        {exceedsToday && <span className="mt-1 block text-xs font-medium text-red-700">This decrease is greater than today’s available live birds.</span>}
        {errors.quantity && <span className="mt-1 block text-sm font-normal text-red-700">{errors.quantity.message}</span>}
      </label>
      {type === "adjustment" && <label className="text-sm font-medium">Direction<select className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3" {...register("direction")}><option value="IN">Increase</option><option value="OUT">Decrease</option></select></label>}
      <label className="text-sm font-medium sm:col-span-2">
        {type === "adjustment" ? "Reason *" : "Notes"}
        <textarea className="mt-2 min-h-24 w-full rounded-lg border border-stone-300 p-3" {...register("notes")} />
        {errors.notes && <span className="mt-1 block text-sm font-normal text-red-700">{errors.notes.message}</span>}
        {type === "adjustment" && <span className="mt-1 block text-xs font-normal text-stone-500">Explain why the flock population is being corrected; this is retained with the movement.</span>}
      </label>
      {status && <p className={`text-sm sm:col-span-2 ${status.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{status.text}</p>}
      <div className="sm:col-span-2"><Button disabled={pending || exceedsToday}>{pending ? "Saving…" : "Add movement"}</Button></div>
    </form>
  );
}
