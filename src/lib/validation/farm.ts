import { z } from "zod";
import { canonicalFarmTimezone, isValidFarmTimezone } from "@/lib/farm-date";
export const farmNameSchema = z.string().trim().min(2, "Farm name is required.").max(120);
export const farmCurrencySchema = z.string().trim().length(3, "Enter a 3-letter currency code, such as NGN for Nigerian naira.").transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/, "Enter a 3-letter currency code, such as NGN for Nigerian naira."));
export const farmTimezoneSchema = z.string().trim().min(1, "Timezone is required.").max(100).refine(isValidFarmTimezone, "Enter a valid timezone, such as Africa/Lagos for Nigeria.").transform((timezone) => canonicalFarmTimezone(timezone)!);
const numeric = z.coerce.number();
export const farmSettingsSchema = z.object({
  name: farmNameSchema, currency: farmCurrencySchema, timezone: farmTimezoneSchema,
  crateSize: numeric.int().positive(), feedBagSizeKg: numeric.positive(), openingCashBalance: numeric.nonnegative(), defaultEggPricePerCrate: numeric.nonnegative(),
  defaultLooseEggPrice: numeric.nonnegative(), feedAlertWarningDays: numeric.int().nonnegative(), feedAlertCriticalDays: numeric.int().nonnegative(), averageFeedDaysWindow: numeric.int().positive(),
}).refine((d) => d.feedAlertCriticalDays <= d.feedAlertWarningDays, { message: "Critical days cannot exceed warning days.", path: ["feedAlertCriticalDays"] });
