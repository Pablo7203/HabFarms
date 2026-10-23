import { z } from "zod";
import { requiredNumber } from "@/lib/validation/numbers";

const number = z.coerce.number();
const text = z.string().trim().max(2000).optional().default("");
export const rearingBatchSchema = z.object({
  batchCode: z.string().trim().max(40).optional().default(""),
  birdPurpose: z.enum(["layer_pullet", "broiler"]),
  breed: z.string().trim().min(1, "Enter a breed or strain.").max(120),
  supplierId: z.union([z.literal(""), z.uuid()]).optional().default(""),
  arrivalDate: z.iso.date(),
  hatchDate: z.union([z.literal(""), z.iso.date()]).optional().default(""),
  initialQuantity: number.int("Enter a whole number of chicks.").positive("Initial chicks must be greater than zero."),
  notes: text,
});
export const rearingBatchUpdateSchema = rearingBatchSchema.omit({ batchCode: true, initialQuantity: true, birdPurpose: true });
export const rearingDailySchema = z.object({
  recordDate: z.iso.date(),
  deaths: requiredNumber(z.number().int("Deaths must be a whole number.").nonnegative("Deaths cannot be negative."), "DOC deaths (use 0 if none)"),
  observations: text,
  feedCheck: z.union([z.literal(""), z.enum(["normal", "reduced", "not_checked"])]).optional().default(""),
  waterCheck: z.union([z.literal(""), z.enum(["normal", "reduced", "not_checked"])]).optional().default(""),
  brooderTemperatureC: z.union([z.literal(""), z.coerce.number().min(-10).max(60)]).optional().default(""),
});
export const rearingWeightSampleSchema = z.object({
  sampleDate: z.iso.date(),
  sampleSize: number.int().positive().max(1000000),
  averageWeightKg: z.coerce.number().positive().max(50),
  uniformityPercentage: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).optional().default(""),
  notes: text,
});
export const broilerDispatchSchema = z.object({
  dispatchDate: z.iso.date(),
  quantity: number.int().positive().max(1000000),
  buyerName: z.string().trim().max(160).optional().default(""),
  totalAmount: requiredNumber(z.number().nonnegative().max(1000000000), "dispatch amount (use 0 if no charge)"),
  notes: text,
});
