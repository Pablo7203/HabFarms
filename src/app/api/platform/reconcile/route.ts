import { NextRequest, NextResponse } from "next/server";
import { createAuthAdminClient } from "@/lib/supabase/admin";

// This endpoint is deliberately inert until PLATFORM_RECONCILE_SECRET is configured
// in the hosting environment and a scheduler is pointed at it.
export async function POST(request: NextRequest) {
  const secret = process.env.PLATFORM_RECONCILE_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 404 });
  }

  const requestedDate = request.nextUrl.searchParams.get("asOf");
  const asOf = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : new Date().toISOString().slice(0, 10);
  const admin = createAuthAdminClient();
  const { data, error } = await admin.rpc("platform_reconcile_subscription_lifecycle", { target_as_of: asOf });
  if (error) return NextResponse.json({ ok: false, message: "Lifecycle reconciliation failed." }, { status: 500 });
  return NextResponse.json({ ok: true, processed: data, asOf });
}
