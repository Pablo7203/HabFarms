import { z } from "zod";

const number = z.coerce.number();
const text = z.string().trim().max(2000).optional().default("");
export const rearingBatchSchema = z.object({
  batchCode: z.string().trim().max(40).optional().default(""),
  breed: z.string().trim().min(1, "Enter a breed or strain.").max(120),
  supplierId: z.union([z.literal(""), z.uuid()]).optional().default(""),
  arrivalDate: z.iso.date(),
  hatchDate: z.union([z.literal(""), z.iso.date()]).optional().default(""),
  initialQuantity: number.int("Enter a whole number of chicks.").positive("Initial chicks must be greater than zero."),
  notes: text,
});
export const rearingBatchUpdateSchema = rearingBatchSchema.omit({ batchCode: true, initialQuantity: true });
export const rearingDailySchema = z.object({
  recordDate: z.iso.date(),
  deaths: number.int("Deaths must be a whole number.").nonnegative("Deaths cannot be negative."),
  observations: text,
});
