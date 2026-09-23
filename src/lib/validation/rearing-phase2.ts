import { z } from "zod";

const text = z.string().trim().max(2000).optional().default("");
const method = z.enum(["cash", "momo", "bank_transfer", "other"]);

export const rearingFeedConsumptionSchema = z.object({
  feedTypeId: z.uuid(), consumptionDate: z.iso.date(), quantityKg: z.coerce.number().positive().max(100000),
  dailyRecordId: z.union([z.literal(""), z.uuid()]).optional().default(""), notes: text,
});
export const rearingFeedCorrectionSchema = z.object({
  feedTypeId: z.uuid(), consumptionDate: z.iso.date(), quantityKg: z.coerce.number().positive().max(100000),
  reason: z.string().trim().min(3, "Give a reason for this correction.").max(500), notes: text,
});
export const rearingFeedPlanSchema = z.object({
  feedTypeId: z.uuid(), feedingStage: z.string().trim().min(2).max(60),
  gramsPerBirdPerDay: z.coerce.number().positive().max(1000), effectiveFrom: z.iso.date(), notes: text,
});
export const rearingHealthSchema = z.object({
  recordDate: z.iso.date(), healthType: z.enum(["vaccine", "antibiotic", "vitamin", "dewormer", "treatment", "veterinary_service", "other"]),
  productName: z.string().trim().min(2).max(160), reason: text, dose: z.string().trim().max(120).optional().default(""),
  route: z.string().trim().max(120).optional().default(""), duration: z.string().trim().max(120).optional().default(""),
  quantity: z.union([z.literal(""), z.coerce.number().nonnegative()]), quantityUnit: z.string().trim().max(60).optional().default(""),
  veterinaryProvider: z.string().trim().max(160).optional().default(""), cost: z.coerce.number().nonnegative().default(0),
  nextDueDate: z.union([z.literal(""), z.iso.date()]), notes: text, initialPayment: z.coerce.number().nonnegative().default(0),
  paymentMethod: method, reference: z.string().trim().max(160).optional().default(""),
}).refine((x) => !x.nextDueDate || x.nextDueDate >= x.recordDate, { message: "Next due date cannot be before the activity date." })
  .refine((x) => x.initialPayment <= x.cost, { message: "Paid now cannot exceed the health cost." });
export const rearingHealthReminderSchema = z.object({
  activityType: z.enum(["vaccination", "treatment_follow_up", "medication", "inspection", "other"]),
  title: z.string().trim().min(2).max(160), dueDate: z.iso.date(), notes: text,
});
export const rearingCostExpenseSchema = z.object({
  costKind: z.enum(["acquisition", "other_direct"]), expenseDate: z.iso.date(), categoryId: z.uuid(),
  description: z.string().trim().min(2).max(300), supplierId: z.union([z.literal(""), z.uuid()]).optional().default(""),
  payeeName: z.string().trim().max(160).optional().default(""), amount: z.coerce.number().positive(),
  initialPayment: z.coerce.number().nonnegative().default(0), paymentMethod: method,
  reference: z.string().trim().max(160).optional().default(""), notes: text,
}).refine((x) => x.initialPayment <= x.amount, { message: "Paid now cannot exceed the expense amount." });

export const rearingTransferSchema = z.object({
  transferDate: z.iso.date(),
  quantity: z.coerce.number().int().positive().max(1000000),
  destinationFlockId: z.union([z.literal(""), z.uuid()]).default(""),
  newFlockName: z.string().trim().max(120).optional().default(""),
  newFlockBatchReference: z.string().trim().max(120).optional().default(""),
  newFlockBreed: z.string().trim().max(120).optional().default(""),
  newFlockHousePen: z.string().trim().max(120).optional().default(""),
  newFlockAgeWeeks: z.union([z.literal(""), z.coerce.number().int().nonnegative().max(200)]).optional().default(""),
  notes: text,
  costReviewed: z.boolean(),
  idempotencyKey: z.uuid(),
}).refine((x) => Boolean(x.destinationFlockId) !== Boolean(x.newFlockName), {
  message: "Choose one existing flock or enter a name for a new flock.",
}).refine((x) => !x.newFlockName || x.newFlockName.length >= 2, {
  message: "New flock name must be at least 2 characters.",
});
