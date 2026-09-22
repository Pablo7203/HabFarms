import { NextRequest, NextResponse } from "next/server";
import { createAuthAdminClient } from "@/lib/supabase/admin";
import { deliverPlatformCommunications } from "@/lib/platform/communications";

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
  const { data: run } = await admin.from("platform_job_runs").insert({ job_type: "subscription_lifecycle", status: "running" }).select("id").single();
  try {
    const { data, error } = await admin.rpc("platform_reconcile_subscription_lifecycle", { target_as_of: asOf });
    if (error) throw error;
    const { data: queued } = await admin.rpc("platform_enqueue_lifecycle_communications", { target_as_of: asOf });
    const deliveryRun = await admin.from("platform_job_runs").insert({ job_type: "communication_delivery", status: "running" }).select("id").single();
    const delivery = await deliverPlatformCommunications();
    if (deliveryRun.data?.id) await admin.from("platform_job_runs").update({ status: "success", completed_at: new Date().toISOString(), records_examined: delivery.sent + delivery.failed + delivery.pending, records_changed: delivery.sent + delivery.failed, error_summary: delivery.providerConfigured ? null : "Email provider is not configured; lifecycle messages remain pending." }).eq("id", deliveryRun.data.id);
    if (run?.id) await admin.from("platform_job_runs").update({ status: "success", completed_at: new Date().toISOString(), records_examined: Number(data ?? 0), records_changed: Number(data ?? 0) }).eq("id", run.id);
    return NextResponse.json({ ok: true, processed: data, queued, delivery, asOf });
  } catch {
    if (run?.id) await admin.from("platform_job_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: "Lifecycle reconciliation failed. Check secure server logs." }).eq("id", run.id);
    return NextResponse.json({ ok: false, message: "Lifecycle reconciliation failed." }, { status: 500 });
  }
}
