import { NextRequest, NextResponse } from "next/server";
import { createAuthAdminClient } from "@/lib/supabase/admin";
import { deliverPlatformCommunications, sendPlatformFailureAlert } from "@/lib/platform/communications";

// Vercel Cron invokes scheduled routes with GET and the CRON_SECRET bearer token.
// Keep POST available for controlled/manual runs under a separate secret.
async function reconcile(request: NextRequest, secret: string | undefined) {
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 404 });
  }

  const requestedDate = request.nextUrl.searchParams.get("asOf");
  const asOf = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : new Date().toISOString().slice(0, 10);
  const admin = createAuthAdminClient();
  const { data: run, error: runError } = await admin.from("platform_job_runs").insert({ job_type: "subscription_lifecycle", status: "running" }).select("id").single();
  if (runError) {
    await sendPlatformFailureAlert("subscription_lifecycle");
    return NextResponse.json({ ok: false, message: "Lifecycle reconciliation could not be started." }, { status: 500 });
  }
  try {
    const { data, error } = await admin.rpc("platform_reconcile_subscription_lifecycle", { target_as_of: asOf });
    if (error) throw error;
    const { data: queued, error: queueError } = await admin.rpc("platform_enqueue_lifecycle_communications", { target_as_of: asOf });
    if (queueError) throw queueError;
    const deliveryRun = await admin.from("platform_job_runs").insert({ job_type: "communication_delivery", status: "running" }).select("id").single();
    if (deliveryRun.error) throw deliveryRun.error;
    const delivery = await deliverPlatformCommunications();
    const deliveryFailed = delivery.failed > 0;
    await admin.from("platform_job_runs").update({ status: deliveryFailed ? "failed" : "success", completed_at: new Date().toISOString(), records_examined: delivery.sent + delivery.failed + delivery.pending, records_changed: delivery.sent + delivery.failed, error_summary: deliveryFailed ? "One or more lifecycle messages failed provider delivery; review communications and secure logs." : delivery.providerConfigured ? null : "Email provider is not configured; lifecycle messages remain pending." }).eq("id", deliveryRun.data.id);
    if (deliveryFailed) await sendPlatformFailureAlert("communication_delivery", deliveryRun.data.id);
    if (run?.id) await admin.from("platform_job_runs").update({ status: "success", completed_at: new Date().toISOString(), records_examined: Number(data ?? 0), records_changed: Number(data ?? 0) }).eq("id", run.id);
    return NextResponse.json({ ok: true, processed: data, queued, delivery, asOf });
  } catch {
    if (run?.id) await admin.from("platform_job_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: "Lifecycle reconciliation failed. Check secure server logs." }).eq("id", run.id);
    await sendPlatformFailureAlert("subscription_lifecycle", run?.id);
    return NextResponse.json({ ok: false, message: "Lifecycle reconciliation failed." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return reconcile(request, process.env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  return reconcile(request, process.env.PLATFORM_RECONCILE_SECRET);
}
