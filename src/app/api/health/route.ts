import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("health_check");
    if (error || data !== 1) throw error ?? new Error("Unexpected health response");
    return NextResponse.json({ status: "ok" }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
