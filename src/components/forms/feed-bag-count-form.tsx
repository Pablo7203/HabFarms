"use client";

import { useState, useTransition } from "react";
import { setFeedInventoryBagCountAction } from "@/app/actions/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function FeedBagCountForm({
  feedTypeId,
  bagCount,
  canEdit,
}: {
  feedTypeId: string;
  bagCount: number | null;
  canEdit: boolean;
}) {
  const [count, setCount] = useState(bagCount?.toString() ?? "");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start(async () => {
      const result = await setFeedInventoryBagCountAction(feedTypeId, { bagCount: count });
      setMessage(result.message);
    });
  }

  if (!canEdit) {
    return (
      <p className="mt-4 text-sm text-stone-600">
        Bags noted: <span className="font-semibold text-stone-900">{bagCount ?? "Not recorded"}</span>
        <span className="ml-1 text-xs text-stone-500">(manual count)</span>
      </p>
    );
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-xl border border-stone-200 bg-stone-50/80 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-36 flex-1 text-xs font-semibold text-stone-600">
          Bags on hand <span className="font-normal text-stone-500">(manual note)</span>
          <Input
            aria-label="Manual number of bags in stock"
            type="number"
            min="0"
            max="1000000"
            step="1"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            placeholder="Not recorded"
            className="mt-1 bg-white"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save count"}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-stone-500">
        This note does not change automatically when feed is used. Kilograms remain the stock balance.
      </p>
      {message && <p role="status" className="mt-2 text-xs text-stone-700">{message}</p>}
    </form>
  );
}
