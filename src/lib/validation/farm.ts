import { z } from "zod";
export const farmNameSchema = z.string().trim().min(2, "Farm name is required.").max(120);
const numeric = z.coerce.number();
export const farmSettingsSchema = z.object({
  name: farmNameSchema, currency: z.string().trim().length(3).transform((v) => v.toUpperCase()), timezone: z.string().trim().min(1).max(100),
  crateSize: numeric.int().positive(), feedBagSizeKg: numeric.positive(), openingCashBalance: numeric.nonnegative(), defaultEggPricePerCrate: numeric.nonnegative(),
  defaultLooseEggPrice: numeric.nonnegative(), feedAlertWarningDays: numeric.int().nonnegative(), feedAlertCriticalDays: numeric.int().nonnegative(), averageFeedDaysWindow: numeric.int().positive(),
}).refine((d) => d.feedAlertCriticalDays <= d.feedAlertWarningDays, { message: "Critical days cannot exceed warning days.", path: ["feedAlertCriticalDays"] });
