"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchActiveFarmAction } from "@/app/actions/auth";
import type { FarmChoice } from "@/types/domain";

export function FarmSwitcher({ farms, activeFarmId }: { farms: FarmChoice[]; activeFarmId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (farms.length < 2) return null;
  return <label className="sr-only">Active farm<select value={activeFarmId} disabled={pending} onChange={(event) => startTransition(async () => { const result = await switchActiveFarmAction(event.target.value); if (result.ok) { router.replace("/dashboard"); router.refresh(); } })} className="not-sr-only min-h-10 max-w-44 rounded-lg border border-stone-200 bg-white px-2 text-sm font-semibold text-stone-800"><option value={activeFarmId}>{farms.find((farm) => farm.id === activeFarmId)?.name ?? "Current farm"}</option>{farms.filter((farm) => farm.id !== activeFarmId).map((farm) => <option key={farm.id} value={farm.id}>{farm.name} · {farm.role}</option>)}</select></label>;
}
