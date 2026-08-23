import { NextResponse } from "next/server";
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

  return NextResponse.redirect(new URL(error ? "/login" : next, url.origin));
}
