import { z } from "zod";
export const invitationSchema=z.object({email:z.string().trim().toLowerCase().email("Enter a valid email address."),role:z.enum(["admin","manager","worker"])});
export const invitationIdSchema=z.string().uuid("Invalid invitation.");
export const memberUpdateSchema=z.object({membershipId:z.string().uuid(),role:z.enum(["admin","manager","worker"]).optional(),active:z.boolean().optional()});
export const acceptInvitationSchema=z.object({invitationId:z.string().uuid()});
