import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const emailOtpTypes = new Set<EmailOtpType>(["email", "recovery", "invite", "email_change"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const requested = url.searchParams.get("next");
  const next = requested?.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") ? requested : "/dashboard";
  const supabase = await createClient();

  const { error } = tokenHash && type && emailOtpTypes.has(type)
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("Missing authentication token") };

  if (!error) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const cookieStore = await cookies();
      const currentFarmId = cookieStore.get("habfarms_active_farm")?.value;
      const { data: currentMembership } = currentFarmId
        ? await supabase.from("farm_members").select("farm_id").eq("farm_id", currentFarmId).eq("user_id", user.id).eq("active", true).maybeSingle()
        : { data: null };
      const { data: initialMembership } = currentMembership
        ? { data: currentMembership }
        : await supabase.from("farm_members").select("farm_id").eq("user_id", user.id).eq("active", true).order("created_at").limit(1).maybeSingle();
      if (initialMembership) cookieStore.set("habfarms_active_farm", initialMembership.farm_id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    }
  }

  return NextResponse.redirect(new URL(error ? "/login" : next, url.origin));
}
