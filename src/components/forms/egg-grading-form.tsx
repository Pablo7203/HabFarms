"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postGradingAction } from "@/app/actions/eggs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Grade = { id: string; name: string };

export function EggGradingForm({
  grades,
  available,
  today,
  crateSize,
}: {
  grades: Grade[];
  available: number;
  today: string;
  crateSize: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [input, setInput] = useState(0);
  const [values, setValues] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const allocated = Object.values(values).reduce((total, value) => total + value, 0);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await postGradingAction({
            gradingDate: date,
            inputQuantityEggs: input,
            allocations: grades.map((grade) => ({
              eggGradeId: grade.id,
              quantityEggs: values[grade.id] ?? 0,
            })),
            notes,
          });
          if (result.ok) router.push("/eggs?graded=1");
          else setError(result.message);
        });
      }}
    >
      <div className="rounded-xl bg-emerald-950 p-5 text-white">
        <p className="text-emerald-200">Available Unsorted</p>
        <p className="text-3xl font-bold">{available} eggs</p>
        <p>{Math.floor(available / crateSize)} crates + {available % crateSize} loose</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Date<Input className="mt-2" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Quantity to grade<Input className="mt-2" type="number" min="1" max={available} value={input} onChange={(event) => setInput(Number(event.target.value))} /></label>
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 font-semibold">Output grade quantities</legend>
        {grades.map((grade) => (
          <label key={grade.id}>{grade.name}<Input className="mt-2" type="number" min="0" value={values[grade.id] ?? 0} onChange={(event) => setValues((current) => ({ ...current, [grade.id]: Number(event.target.value) }))} /></label>
        ))}
      </fieldset>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-stone-50 p-3">Input <b className="block">{input}</b></div>
        <div className="rounded-lg bg-stone-50 p-3">Allocated <b className="block">{allocated}</b></div>
        <div className={`rounded-lg p-3 ${input - allocated === 0 ? "bg-emerald-50" : "bg-amber-50"}`}>Difference <b className="block">{input - allocated}</b></div>
      </div>
      <label>Notes<textarea className="mt-2 min-h-24 w-full rounded-lg border p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <Button disabled={pending || input <= 0 || input > available || allocated !== input}>{pending ? "Posting…" : "Post grading"}</Button>
    </form>
  );
}
