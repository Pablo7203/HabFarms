import assert from "node:assert/strict";
import { dailyProductionV1, mortalityV1 } from "../src/lib/desktop/sync-contract.ts";

const base = {
  operationId: "00000000-0000-4000-8000-000000000001",
  farmId: "00000000-0000-4000-8000-000000000002",
  flockId: "00000000-0000-4000-8000-000000000003",
  schemaVersion: 1,
  eventDate: "2026-10-20",
  createdAtLocal: "2026-10-20T12:00:00Z",
  queuedAtLocal: "2026-10-20T12:00:01Z",
  dependencies: [],
};
let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed++;
  console.log(`PASS ${label}`);
}

const mortality = { ...base, operationType: "MORTALITY_V1", payload: { quantity: 5, notes: "Synthetic" } };
check("valid mortality operation", mortalityV1.safeParse(mortality).success);
check("client role field rejected", !mortalityV1.safeParse({ ...mortality, role: "admin" }).success);
check("client population field rejected", !mortalityV1.safeParse({ ...mortality, serverPopulation: 100 }).success);
check("invalid mortality quantity rejected", !mortalityV1.safeParse({ ...mortality, payload: { quantity: 0 } }).success);
check("unsupported mortality schema rejected", !mortalityV1.safeParse({ ...mortality, schemaVersion: 2 }).success);

const production = { ...base, operationType: "DAILY_PRODUCTION_V1", payload: {
  eggsCollected: 80, crackedEggs: 2, deaths: 0, culls: 0, feedConsumedKg: 0,
  feedTypeId: null, transportCost: 0, otherCost: 0, notes: "", gradeAllocations: [],
} };
check("valid unsorted production operation", dailyProductionV1.safeParse(production).success);
check("cracked eggs above collected rejected", !dailyProductionV1.safeParse({ ...production,
  payload: { ...production.payload, crackedEggs: 81 } }).success);
check("feed without feed type rejected", !dailyProductionV1.safeParse({ ...production,
  payload: { ...production.payload, feedConsumedKg: 1 } }).success);
check("grade mismatch rejected", !dailyProductionV1.safeParse({ ...production,
  payload: { ...production.payload, gradeAllocations: [{ eggGradeId: "00000000-0000-4000-8000-000000000004", quantityEggs: 1 }] } }).success);
console.log(`CONTRACT PROOF: ${passed} assertions passed`);
