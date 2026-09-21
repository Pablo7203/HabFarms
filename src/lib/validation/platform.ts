import { z } from "zod";

export const platformFarmSchema = z.object({
  farmName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(160),
  ownerEmail: z.string().trim().email().max(254),
  ownerPhone: z.string().trim().max(50).optional(),
  country: z.string().trim().max(80).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
  planId: z.string().uuid(),
  trialEnabled: z.boolean(),
  trialDays: z.coerce.number().int().min(0).max(365).optional(),
  billingCycle: z.enum(["monthly", "annual"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
