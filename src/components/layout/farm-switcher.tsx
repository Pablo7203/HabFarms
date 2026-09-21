"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchActiveFarmAction } from "@/app/actions/auth";
import type { FarmChoice } from "@/types/domain";

export function FarmSwitcher({ farms, activeFarmId }: { farms: FarmChoice[]; activeFarmId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (farms.length < 2) return null;
  return (
    <div className="mt-1">
      <label htmlFor="active-farm" className="sr-only">Active farm</label>
      <select
        id="active-farm"
        value={activeFarmId}
        disabled={pending}
        onChange={(event) => startTransition(async () => {
          const result = await switchActiveFarmAction(event.target.value);
          if (result.ok) {
            router.replace(result.nextPath ?? "/dashboard");
            router.refresh();
          }
        })}
        className="min-h-9 w-full max-w-44 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-wait disabled:opacity-60"
      >
        <option value={activeFarmId}>{farms.find((farm) => farm.id === activeFarmId)?.name ?? "Current farm"}</option>
        {farms.filter((farm) => farm.id !== activeFarmId).map((farm) => <option key={farm.id} value={farm.id}>{farm.name} · {farm.role}</option>)}
      </select>
    </div>
  );
}
