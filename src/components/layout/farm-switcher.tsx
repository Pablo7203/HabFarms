"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { switchActiveFarmAction } from "@/app/actions/auth";
import type { FarmChoice } from "@/types/domain";

export function FarmSwitcher({ farms, activeFarmId }: { farms: FarmChoice[]; activeFarmId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (farms.length < 2) return null;
  return (
    <div className="mt-2 w-full">
      <label htmlFor="active-farm" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.11em] text-stone-400">Switch farm</label>
      <div className="relative">
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
          className="min-h-10 w-full appearance-none rounded-xl border border-stone-200 bg-stone-50 px-3 pr-10 text-sm font-semibold text-stone-800 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          <option value={activeFarmId}>{farms.find((farm) => farm.id === activeFarmId)?.name ?? "Current farm"}</option>
          {farms.filter((farm) => farm.id !== activeFarmId).map((farm) => <option key={farm.id} value={farm.id}>{farm.name} · {farm.role}</option>)}
        </select>
        <ChevronsUpDown aria-hidden="true" size={16} strokeWidth={1.8} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-500" />
      </div>
    </div>
  );
}
