import { z } from "zod";

// z.coerce.number() converts an empty form field (and null) to zero. For
// quantities and money this silently turns missing input into real data.
export function requiredNumber(schema: z.ZodNumber, label: string) {
  return z.preprocess((value, context) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    context.addIssue({ code: "custom", message: `Enter ${label}.` });
    return z.NEVER;
  }, schema);
}
