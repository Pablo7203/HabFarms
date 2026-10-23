import assert from "node:assert/strict";
import { projectLocalState } from "./src/projections.ts";

const snapshot = {
  flocks: [{ id: "flock-a", currentLiveBirds: 100 }],
  eggGrades: [{ id: "unsorted", name: "Unsorted", isUnsorted: true }, { id: "small", name: "Small", isUnsorted: false }],
};
const mortality = (id, quantity, state, eventDate, queuedAtLocal) => ({ state, operationJson: JSON.stringify({
  operationId: id, farmId: "farm-a", flockId: "flock-a", schemaVersion: 1, operationType: "MORTALITY_V1",
  eventDate, createdAtLocal: "2026-10-21T00:00:00Z", queuedAtLocal, dependencies: [], payload: { quantity, notes: "" },
}) });
const production = { state: "PENDING_SYNC", operationJson: JSON.stringify({ operationId: "op-prod", farmId: "farm-a",
  flockId: "flock-a", schemaVersion: 1, operationType: "DAILY_PRODUCTION_V1", eventDate: "2026-10-21",
  createdAtLocal: "2026-10-21T08:00:00Z", queuedAtLocal: "2026-10-21T08:01:00Z", dependencies: [],
  payload: { eggsCollected: 10, crackedEggs: 2, deaths: 1, culls: 1, feedConsumedKg: 0, feedTypeId: null,
    transportCost: 0, otherCost: 0, notes: "", gradeAllocations: [{ eggGradeId: "small", quantityEggs: 8 }] },
}) };
const result = projectLocalState(snapshot, [
  mortality("op-1", 2, "PENDING_SYNC", "2026-10-20", "2026-10-21T08:02:00Z"),
  production,
  mortality("op-draft", 50, "DRAFT", "2026-10-21", "2026-10-21T08:03:00Z"),
  mortality("op-done", 25, "SYNCED", "2026-10-21", "2026-10-21T08:04:00Z"),
]);
assert.equal(result.projectedPopulation.get("flock-a"), 96, "pending mortality and production losses project once");
assert.equal(result.pendingCount, 2, "only pending operations are counted");
assert.equal(result.draftCount, 1, "draft remains outside projections and pending count");
assert.equal(result.pendingEggAdds.get("small"), 8, "graded production adds the good-egg quantity by grade");
assert.equal(result.entries.length, 4, "local history retains drafts and completed rows");
assert.equal(snapshot.flocks[0].currentLiveBirds, 100, "server-confirmed snapshot is never overwritten");
const eventDate = JSON.parse(mortality("date-check", 1, "PENDING_SYNC", "2026-10-20", "2026-10-21T00:01:00+00:00").operationJson).eventDate;
assert.equal(eventDate, "2026-10-20", "date-only event date survives timestamp timezone offsets");
assert.equal(projectLocalState({ ...snapshot, synchronizedAt: "2026-10-21T08:30:00Z" }, [mortality("lost-ack", 3, "PENDING_SYNC", "2026-10-21", "2026-10-21T08:00:00Z")]).mayIncludePendingOperations, true, "new snapshot can already include a pending operation after a lost acknowledgement");
assert.equal(projectLocalState({ ...snapshot, synchronizedAt: "2026-10-21T07:00:00Z" }, [mortality("new-op", 3, "PENDING_SYNC", "2026-10-21", "2026-10-21T08:00:00Z")]).mayIncludePendingOperations, false, "older snapshot cannot include later queued work");
console.log("PHASE 2 PROJECTION: 9 assertions passed");
