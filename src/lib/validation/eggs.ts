import { z } from "zod";

const notes = z.string().trim().max(2000, "Notes must be 2,000 characters or fewer.").optional().default("");
export const eggGradingSchema = z.object({
  gradingDate: z.iso.date("Choose a valid grading date."),
  inputQuantityEggs: z.coerce.number().int("Input quantity must be a whole number of eggs.").positive("Enter the number of eggs to grade."),
  allocations: z.array(z.object({ eggGradeId: z.uuid("Choose a valid egg grade."), quantityEggs: z.coerce.number().int().nonnegative("Grade quantities must be whole, non-negative numbers.") })).min(1, "Add at least one egg grade allocation."),
  notes,
}).superRefine((value, ctx) => {
  const allocated = value.allocations.reduce((total, item) => total + item.quantityEggs, 0);
  if (allocated !== value.inputQuantityEggs) ctx.addIssue({ code: "custom", path: ["allocations"], message: `Grade allocations total ${allocated} eggs; they must equal the ${value.inputQuantityEggs} eggs being graded.` });
});
export const eggPriceSchema = z.object({
  eggGradeId: z.uuid("Choose a valid egg grade."),
  effectiveFrom: z.iso.date("Choose a valid effective date."),
  cratePrice: z.union([z.literal(""), z.coerce.number().finite().nonnegative("Crate price cannot be negative.")]),
  looseEggPrice: z.union([z.literal(""), z.coerce.number().finite().nonnegative("Loose egg price cannot be negative.")]),
  notes,
}).refine(value => value.cratePrice !== "" || value.looseEggPrice !== "", { message: "Enter a price for at least one unit (crate or loose egg).", path: ["cratePrice"] });
export const openingEggStockSchema = z.object({
  eggGradeId: z.uuid("Choose a valid egg grade."),
  effectiveDate: z.iso.date("Choose a valid opening-stock date."),
  quantityEggs: z.coerce.number().int("Opening stock must be a whole number of eggs.").positive("Enter a quantity greater than zero."),
  notes: z.string().trim().min(3, "Explain why this opening balance is being recorded.").max(2000, "Notes must be 2,000 characters or fewer."),
});
