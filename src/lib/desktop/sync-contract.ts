import { z } from "zod";

// Portable wire types. These validate shape; PostgreSQL remains the authority.
const envelope = z.strictObject({
  operationId: z.uuid(),
  farmId: z.uuid(),
  createdAtLocal: z.iso.datetime({ offset: true }),
  queuedAtLocal: z.iso.datetime({ offset: true }),
  dependencies: z.array(z.uuid()).max(32).default([]),
});

export const mortalityV1 = envelope.extend({
  schemaVersion: z.literal(1),
  operationType: z.literal("MORTALITY_V1"),
  flockId: z.uuid(),
  eventDate: z.iso.date(),
  payload: z.strictObject({ quantity: z.number().int().positive().max(2_000_000), notes: z.string().trim().max(2000).default("") }),
});

export const dailyProductionV1 = envelope.extend({
  schemaVersion: z.literal(1),
  operationType: z.literal("DAILY_PRODUCTION_V1"),
  flockId: z.uuid(),
  eventDate: z.iso.date(),
  payload: z.strictObject({
    eggsCollected: z.number().int().nonnegative().max(2_000_000),
    crackedEggs: z.number().int().nonnegative().max(2_000_000),
    deaths: z.number().int().nonnegative().max(2_000_000),
    culls: z.number().int().nonnegative().max(2_000_000),
    feedConsumedKg: z.number().nonnegative().max(1_000_000),
    feedTypeId: z.uuid().nullable(),
    transportCost: z.number().nonnegative().max(1_000_000_000),
    otherCost: z.number().nonnegative().max(1_000_000_000),
    notes: z.string().trim().max(2000),
    gradeAllocations: z.array(z.strictObject({ eggGradeId: z.uuid(), quantityEggs: z.number().int().nonnegative().max(2_000_000) })),
  }).refine((p) => p.crackedEggs <= p.eggsCollected, "Cracked eggs exceed collected eggs")
    .refine((p) => p.feedConsumedKg === 0 || p.feedTypeId !== null, "Feed type required")
    .refine((p) => p.gradeAllocations.length === 0 || p.gradeAllocations.reduce((n, g) => n + g.quantityEggs, 0) === p.eggsCollected - p.crackedEggs, "Grade allocations differ from good eggs"),
});

export const desktopOperationV1 = z.discriminatedUnion("operationType", [mortalityV1, dailyProductionV1]);
export type DesktopOperationV1 = z.infer<typeof desktopOperationV1>;

export const syncResultCode = z.enum([
  "SUCCESS", "ALREADY_SYNCED", "CONFLICT", "VALIDATION_FAILED",
  "AUTHORIZATION_FAILED", "ACCESS_BLOCKED", "SESSION_EXPIRED",
  "RETRYABLE_FAILURE", "OPERATION_ID_REUSED", "UNSUPPORTED_SCHEMA_VERSION",
]);


export const desktopSyncRequestV1 = z.strictObject({
  protocolVersion: z.literal(1),
  appVersion: z.string().trim().min(1).max(32),
  localSchemaVersion: z.number().int().positive(),
  installationId: z.uuid(),
  farmId: z.uuid(),
  operations: z.array(desktopOperationV1).min(1).max(20),
});

export const desktopSyncOutcomeV1 = z.strictObject({
  operationId: z.uuid(),
  code: z.enum([
    "SUCCESS", "ALREADY_SYNCED", "OPERATION_ID_REUSED", "DAILY_PRODUCTION_EXISTS",
    "CONFLICT", "VALIDATION_FAILED", "AUTHORIZATION_FAILED", "RETRYABLE_FAILURE",
  ]),
  receipt: z.unknown().optional(),
  message: z.string().max(300).optional(),
});
