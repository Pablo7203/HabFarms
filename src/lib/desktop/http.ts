import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

const allowedOrigins = new Set([
  "tauri://localhost", "http://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420",
]);

export function desktopResponse(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin") ?? "";
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
  if (allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization,content-type");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  return Response.json(body, { status, headers });
}

export function desktopOptions(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(origin)) return desktopResponse(request, { code: "ORIGIN_NOT_ALLOWED" }, 403);
  const headers = new Headers({
    "Cache-Control": "no-store", "Vary": "Origin",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  return new Response(null, { status: 204, headers });
}

export async function desktopIdentity(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const auth = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await auth.auth.getUser(token);
  if (verified.error || !verified.data.user?.id || !verified.data.user.email) return null;
  return { token, userId: verified.data.user.id, email: verified.data.user.email };
}
