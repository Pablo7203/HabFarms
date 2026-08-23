import { z } from "zod";
export const emailSchema = z.string().trim().email("Enter a valid email address.");
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters.");
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const signupSchema = loginSchema.extend({ fullName: z.string().trim().min(2).max(100) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ password: passwordSchema });
