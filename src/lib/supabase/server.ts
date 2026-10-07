import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
export async function createClient(activeFarmOverride?: string) {
  const cookieStore = await cookies();
  const activeFarmId = activeFarmOverride ?? cookieStore.get("habfarms_active_farm")?.value;
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: activeFarmId ? { "x-habfarms-active-farm": activeFarmId } : {} },
    cookies: {
    getAll: () => cookieStore.getAll(),
    setAll: (items) => { try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* proxy refreshes Server Component sessions */ } },
  } });
}
