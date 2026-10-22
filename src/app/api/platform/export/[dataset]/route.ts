import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

const csv = toCsv;
type PageResult<T> = { data: T[] | null; error: { message: string } | null };
async function readAllPages<T>(fetchPage: (start: number, end: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await fetchPage(start, start + 999);
    if (page.error) throw new Error("Export query failed");
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < 1000) return rows;
  }
}

export async function GET(request: NextRequest, context: RouteContext<"/api/platform/export/[dataset]">) {
  const { dataset } = await context.params;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data: admin } = await supabase.rpc("is_platform_admin");
  if (!user.user || !admin) return new NextResponse("Not found", { status: 404 });
  const search = request.nextUrl.searchParams;
  let body: string; let filename: string;
  if (dataset === "portfolio") {
    const { data, error } = await supabase.rpc("platform_farm_portfolio", { target_search: search.get("q") || null, target_account_status: search.get("status") || null, target_subscription_status: search.get("subscription") || null, target_plan: null, target_onboarding_status: null, target_limit: 100, target_offset: 0 });
    if (error) return new NextResponse("Unable to generate export", { status: 500 });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    body = csv(["Farm", "Owner", "Email", "Phone", "Plan", "Account status", "Subscription status", "Onboarding status", "Onboarding %", "Created", "Next billing", "Outstanding", "Currency"], rows.map((row) => [row.farm_name, row.owner_name, row.owner_email, row.owner_phone, row.plan_name, row.account_status, row.subscription_status, row.onboarding_status, row.onboarding_percentage, row.created_at, row.next_billing_date, row.outstanding, row.currency])); filename = "habfarms-farm-portfolio.csv";
  } else if (dataset === "collections") {
    const { data, error } = await supabase.rpc("platform_subscription_collections", { target_category: search.get("status") || null, target_limit: 100, target_offset: 0 });
    if (error) return new NextResponse("Unable to generate export", { status: 500 });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    body = csv(["Farm", "Owner", "Plan", "Collection status", "Due date", "Amount due", "Amount paid", "Outstanding", "Currency"], rows.map((row) => [row.farm_name, row.owner_name, row.plan_name, row.collection_status, row.due_date, row.amount_due, row.amount_paid, row.outstanding, row.currency])); filename = "habfarms-subscription-collections.csv";
  } else if (dataset === "payments") {
    const [payments, { data: subscriptions, error: subscriptionsError }] = await Promise.all([readAllPages((start, end) => supabase.from("subscription_payments").select("id,subscription_id,amount,currency,payment_method,payment_reference,paid_at,status,created_at").order("paid_at", { ascending: false }).order("id").range(start, end)), supabase.rpc("platform_get_subscription_summaries")]);
    if (subscriptionsError) return new NextResponse("Unable to generate export", { status: 500 });
    const summaries = new Map(((subscriptions ?? []) as Array<{ subscription_id: string; farm_name: string; plan_name: string }>).map((item) => [item.subscription_id, item]));
    body = csv(["Payment date", "Farm", "Plan", "Amount", "Currency", "Method", "Reference", "Status", "Recorded at"], payments.map((payment) => { const subscription = summaries.get(payment.subscription_id); return [payment.paid_at, subscription?.farm_name, subscription?.plan_name, payment.amount, payment.currency, payment.payment_method, payment.payment_reference, payment.status, payment.created_at]; })); filename = "habfarms-subscription-payments.csv";
  } else return new NextResponse("Not found", { status: 404 });
  return new NextResponse(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
}
