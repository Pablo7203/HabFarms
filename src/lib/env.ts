import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().refine(value => value.startsWith("https://") || value.startsWith("http://127.0.0.1") || value.startsWith("http://localhost"), "Supabase URL must use HTTPS outside local development"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const parsed = schema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsed.success) throw new Error(`Invalid application environment: ${parsed.error.issues.map(issue => issue.path.join(".")).join(", ")}`);

export const env = Object.freeze(parsed.data);
