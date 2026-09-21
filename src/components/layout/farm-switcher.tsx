"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight, Check, ChevronDown, LoaderCircle } from "lucide-react";
import { switchActiveFarmAction } from "@/app/actions/auth";
import type { FarmChoice } from "@/types/domain";

export function FarmSwitcher({ farms, activeFarmId }: { farms: FarmChoice[]; activeFarmId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const activeFarm = farms.find((farm) => farm.id === activeFarmId) ?? farms[0];

  const selectFarm = (farmId: string) => {
    if (farmId === activeFarmId || pending) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await switchActiveFarmAction(farmId);
      if (result.ok) {
        setOpen(false);
        // A full navigation makes the newly written farm cookie available to every
        // server component before the destination renders.  Client-side refreshes
        // could leave the previous farm visible until the user reloaded manually.
        window.location.assign(result.nextPath ?? "/dashboard");
      }
    });
  };

  return (
    <div className="relative px-3 py-3">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,#fbfff7,#f0fae9)] p-3 shadow-[0_8px_22px_rgba(41,76,20,0.06)]">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#98cf43] text-xl font-bold text-[#245110] shadow-sm">
          {activeFarm.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-500">Poultry Farm</p>
          <p className="truncate text-base font-bold text-stone-900">{activeFarm.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />Active farm</p>
        </div>
        <button
          type="button"
          aria-label={`Switch from ${activeFarm.name}`}
          aria-expanded={open}
          aria-controls="farm-switcher-menu"
          onClick={() => setOpen((value) => !value)}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800 transition-colors hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 active:scale-95"
        >
          {open ? <ChevronDown size={20} strokeWidth={2} /> : <ArrowLeftRight size={20} strokeWidth={1.9} />}
        </button>
      </div>

      {open && (
        <div id="farm-switcher-menu" role="menu" aria-label="Choose active farm" className="absolute left-3 right-3 top-[calc(100%-2px)] z-50 overflow-hidden rounded-2xl border border-stone-200 bg-white p-2 shadow-[0_18px_36px_rgba(41,76,20,0.16)]">
          {farms.map((farm) => {
            const selected = farm.id === activeFarmId;
            return (
              <button
                key={farm.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={pending}
                onClick={() => selectFarm(farm.id)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors ${selected ? "bg-emerald-50 text-emerald-950" : "text-stone-700 hover:bg-stone-50"} disabled:cursor-wait disabled:opacity-60`}
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${selected ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{farm.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{farm.name}</span>
                {pending && !selected ? <LoaderCircle className="animate-spin text-emerald-700" size={17} /> : selected ? <Check className="text-emerald-700" size={19} strokeWidth={2.4} /> : null}
              </button>
            );
          })}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{pending ? "Switching farm" : ""}</p>
    </div>
  );
}
