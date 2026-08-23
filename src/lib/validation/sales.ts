import { z } from "zod";
const n=z.coerce.number(),t=z.string().trim().max(1000).optional().default(""),creditDays=z.union([z.literal(""),n.int().min(1).max(365)]).optional();
export const saleItemSchema=z.object({eggGradeId:z.uuid(),unit:z.enum(["crate","loose_egg"]),quantity:n.int().positive(),pricePerUnit:n.nonnegative()});
const saleBase=z.object({customerId:z.union([z.literal(""),z.uuid()]).optional(),saleDate:z.iso.date(),items:z.array(saleItemSchema).min(1),discount:n.nonnegative(),amountPaid:n.nonnegative(),paymentMethod:z.enum(["cash","momo","bank_transfer","other"]),notes:t,creditDays});
export const customerSchema=z.object({name:z.string().trim().min(2).max(120),phone:t,email:z.union([z.literal(""),z.email()]).optional(),location:t,customerType:z.enum(["retail","wholesale","distributor","individual","other"]),notes:t,active:z.boolean().optional().default(true),defaultCreditDays:creditDays});
export const saleSchema=saleBase;
export const saleEditSchema=saleBase.omit({saleDate:true,amountPaid:true,paymentMethod:true});
export const paymentSchema=z.object({paymentDate:z.iso.date(),amount:n.positive(),paymentMethod:z.enum(["cash","momo","bank_transfer","other"]),reference:t,notes:t});
export const creditTermsSchema=z.object({creditDays:n.int().min(1).max(365),dueDate:z.iso.date(),reason:z.string().trim().min(3).max(500)});
