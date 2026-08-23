import { z } from "zod";
const n=z.coerce.number(),text=z.string().trim().max(2000).optional().default("");
export const feedTypeSchema=z.object({name:z.string().trim().min(2).max(120),defaultBagSizeKg:n.positive(),description:text,active:z.boolean().optional().default(true)});
export const supplierSchema=z.object({name:z.string().trim().min(2).max(160),phone:text,email:z.union([z.literal(""),z.email()]).optional().default(""),location:text,notes:text,active:z.boolean().optional().default(true)});
export const purchaseSchema=z.object({supplierId:z.union([z.literal(""),z.uuid()]),feedTypeId:z.uuid(),purchaseDate:z.iso.date(),bags:n.positive(),bagSizeKg:n.positive(),costPerBag:n.nonnegative(),amountPaid:n.nonnegative(),paymentMethod:z.enum(["cash","momo","bank_transfer","other"]),reference:text,notes:text});
export const openingSchema=z.object({feedTypeId:z.uuid(),effectiveDate:z.iso.date(),bags:n.positive(),bagSizeKg:n.positive(),costPerBag:n.nonnegative(),notes:text});
export const adjustmentSchema=z.object({feedTypeId:z.uuid(),movementDate:z.iso.date(),movementType:z.enum(["adjustment","wastage"]),direction:z.enum(["IN","OUT"]),quantityKg:n.positive(),unitCost:z.union([z.literal(""),n.nonnegative()]),reason:z.string().trim().min(3).max(300),notes:text});
export const feedPaymentSchema=z.object({paymentDate:z.iso.date(),amount:n.positive(),paymentMethod:z.enum(["cash","momo","bank_transfer","other"]),reference:text,notes:text});
