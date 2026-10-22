import { z } from "zod";

const notes = z.string().trim().max(2000, "Notes must be 2,000 characters or fewer.").optional().default("");
export const feedingPlanSchema = z.object({
  flockId: z.uuid({ error: "Choose a valid flock." }),
  feedTypeId: z.uuid({ error: "Choose a feed type." }),
  dailyFeedKg: z.coerce.number().finite().positive("Daily feed must be greater than 0 kg.").max(100000, "Daily feed cannot exceed 100,000 kg."),
  effectiveFrom: z.iso.date({ error: "Choose a valid effective date." }),
  notes,
});
export const healthReminderSchema = z.object({
  flockId: z.uuid({ error: "Choose a valid flock." }),
  activityType: z.enum(["vaccination", "treatment_follow_up", "medication", "inspection", "other"], { error: "Choose a health activity type." }),
  title: z.string().trim().min(2, "Enter an activity name.").max(160, "Activity name must be 160 characters or fewer."),
  dueDate: z.iso.date({ error: "Choose a valid due date." }),
  notes,
});
export const completeHealthReminderSchema = z.object({
  reminderId: z.uuid({ error: "The health reminder could not be identified. Refresh the page and try again." }),
  healthRecordId: z.uuid({ error: "Choose a valid linked health record." }).optional(),
});
