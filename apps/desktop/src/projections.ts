import type { DesktopOperationV1 } from "../../../src/lib/desktop/sync-contract";

export type SnapshotForProjection = {
  synchronizedAt?: string;
  flocks: { id: string; currentLiveBirds: number | null }[];
  eggGrades: { id: string; name: string; isUnsorted: boolean }[];
};
export type StoredOperation = { operationJson: string; state: string };

export function projectLocalState(snapshot: SnapshotForProjection, rows: StoredOperation[]) {
  const entries = rows.flatMap((row) => {
    try { return [{ operation: JSON.parse(row.operationJson) as DesktopOperationV1, state: row.state }]; }
    catch { return []; }
  });
  const active = entries.filter((x) => x.state === "PENDING_SYNC" || x.state === "SYNCING");
  const snapshotTime = snapshot.synchronizedAt ? Date.parse(snapshot.synchronizedAt) : NaN;
  const mayIncludePendingOperations = Number.isFinite(snapshotTime) && active.some(({ operation }) => {
    const queuedTime = Date.parse(operation.queuedAtLocal);
    return !Number.isFinite(queuedTime) || queuedTime <= snapshotTime;
  });
  const population = new Map(snapshot.flocks.map((f) => [f.id, f.currentLiveBirds]));
  const ordered = [...active].sort((a, b) => a.operation.eventDate.localeCompare(b.operation.eventDate)
    || a.operation.queuedAtLocal.localeCompare(b.operation.queuedAtLocal)
    || a.operation.operationId.localeCompare(b.operation.operationId));
  for (const { operation } of ordered) {
    const deaths = operation.operationType === "MORTALITY_V1" ? operation.payload.quantity
      : operation.payload.deaths + operation.payload.culls;
    if (!deaths) continue;
    const count = population.get(operation.flockId);
    if (count !== null && count !== undefined) population.set(operation.flockId, count - deaths);
  }
  const eggAdds = new Map<string, number>();
  for (const { operation } of active) {
    if (operation.operationType !== "DAILY_PRODUCTION_V1") continue;
    const goodEggs = operation.payload.eggsCollected - operation.payload.crackedEggs;
    const allocations = operation.payload.gradeAllocations.length
      ? operation.payload.gradeAllocations
      : snapshot.eggGrades.filter((g) => g.isUnsorted).map((g) => ({ eggGradeId: g.id, quantityEggs: goodEggs }));
    for (const allocation of allocations) eggAdds.set(allocation.eggGradeId, (eggAdds.get(allocation.eggGradeId) ?? 0) + allocation.quantityEggs);
  }
  return {
    entries,
    pendingCount: entries.filter((x) => x.state === "PENDING_SYNC" || x.state === "SYNCING").length,
    draftCount: entries.filter((x) => x.state === "DRAFT").length,
    needsAttentionCount: entries.filter((x) => x.state === "NEEDS_ATTENTION").length,
    projectedPopulation: population,
    pendingEggAdds: eggAdds,
    mayIncludePendingOperations,
  };
}
