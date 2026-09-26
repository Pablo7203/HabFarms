import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PlatformInvoicePrintButton } from "@/components/forms/platform-invoice-print-button";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

type BillingPeriod = {
  id: string;
  farm_id: string;
  subscription_id: string;
  plan_name_snapshot: string;
  billing_cycle: "monthly" | "annual";
  currency: string;
  price_snapshot: number | string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount_due: number | string;
  status: "open" | "partial" | "paid" | "void";
  created_at: string;
};

type Allocation = {
  amount: number | string;
  payment: { id: string; status: string; paid_at: string; payment_method: string; payment_reference: string | null } | null;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export default async function PlatformInvoicePage({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  const supabase = await createClient();
  const { data: periodData, error: periodError } = await supabase.from("subscription_billing_periods").select("id,farm_id,subscription_id,plan_name_snapshot,billing_cycle,currency,price_snapshot,period_start,period_end,due_date,amount_due,status,created_at").eq("id", periodId).maybeSingle();
  if (periodError || !periodData) notFound();
  const period = periodData as BillingPeriod;

  const [{ data: farm }, { data: account }, { data: settingsData }, { data: allocationsData, error: allocationsError }] = await Promise.all([
    supabase.from("farms").select("name").eq("id", period.farm_id).maybeSingle(),
    supabase.from("farm_accounts").select("contact_name,contact_email,contact_phone,country").eq("farm_id", period.farm_id).maybeSingle(),
    supabase.rpc("platform_get_settings"),
    supabase.from("subscription_payment_allocations").select("amount,payment:subscription_payments(id,status,paid_at,payment_method,payment_reference)").eq("billing_period_id", period.id),
  ]);
  if (!farm || !account || allocationsError) notFound();

  const settings = (Array.isArray(settingsData) ? settingsData[0] : settingsData) as {
    company_name?: string;
    support_email?: string | null;
    support_phone?: string | null;
    billing_contact_email?: string | null;
  } | null;
  const allocations = (allocationsData ?? []) as unknown as Allocation[];
  const validAllocations = allocations.filter((allocation) => allocation.payment?.status === "posted");
  const paid = validAllocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
  const outstanding = Math.max(0, Number(period.amount_due) - paid);
  const invoiceNumber = `HF-${period.id.toUpperCase()}`;
  const issueDate = period.created_at.slice(0, 10);

  return <>
    <style>{`@page{size:A4;margin:16mm}@media print{body *{visibility:hidden!important}.platform-invoice-document,.platform-invoice-document *{visibility:visible!important}.platform-invoice-document{position:fixed!important;inset:0!important;z-index:9999!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important}.invoice-actions{display:none!important}.invoice-paper{border:0!important;padding:0!important}}`}</style>
    <div className="invoice-actions mx-auto mb-5 flex max-w-4xl flex-wrap items-center justify-between gap-3">
      <Link href={`/platform/subscriptions/${period.subscription_id}`} className="text-sm font-semibold text-emerald-900">← Back to subscription</Link>
      <PlatformInvoicePrintButton invoiceNumber={invoiceNumber} />
    </div>
    <Card className="platform-invoice-document invoice-paper mx-auto max-w-4xl border-stone-200 bg-white p-6 shadow-sm sm:p-10">
      <div className="flex flex-wrap justify-between gap-8 border-b border-stone-200 pb-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">{settings?.company_name || "HabFarms"}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-stone-950">Invoice</h1>
          <p className="mt-2 text-sm text-stone-500">Subscription billing</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 self-end text-sm">
          <dt className="text-stone-500">Invoice no.</dt><dd className="font-semibold">{invoiceNumber}</dd>
          <dt className="text-stone-500">Issued</dt><dd>{dateLabel(issueDate)}</dd>
          <dt className="text-stone-500">Due date</dt><dd>{dateLabel(period.due_date)}</dd>
          <dt className="text-stone-500">Status</dt><dd className="font-semibold capitalize">{period.status === "void" ? "Void" : outstanding <= 0 ? "Paid" : paid > 0 ? "Partially paid" : "Due"}</dd>
        </dl>
      </div>

      <div className="grid gap-8 py-8 sm:grid-cols-2">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Bill to</h2>
          <p className="mt-3 text-lg font-semibold">{farm.name}</p>
          <p className="mt-1 text-sm text-stone-700">{account.contact_name}</p>
          <p className="mt-1 text-sm text-stone-700">{account.contact_email}</p>
          {account.contact_phone && <p className="mt-1 text-sm text-stone-700">{account.contact_phone}</p>}
          {account.country && <p className="mt-1 text-sm text-stone-700">{account.country}</p>}
        </section>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">From</h2>
          <p className="mt-3 text-lg font-semibold">{settings?.company_name || "HabFarms"}</p>
          {settings?.billing_contact_email && <p className="mt-1 text-sm text-stone-700">Billing: {settings.billing_contact_email}</p>}
          {settings?.support_email && <p className="mt-1 text-sm text-stone-700">Support: {settings.support_email}</p>}
          {settings?.support_phone && <p className="mt-1 text-sm text-stone-700">{settings.support_phone}</p>}
        </section>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200">
        <div className="grid grid-cols-[1fr_auto] gap-4 bg-stone-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500 sm:px-5">
          <span>Description</span><span className="text-right">Amount</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-5 sm:px-5">
          <div><p className="font-semibold">{period.plan_name_snapshot} subscription</p><p className="mt-1 text-sm capitalize text-stone-600">{period.billing_cycle} plan · {dateLabel(period.period_start)} – {dateLabel(period.period_end)}</p></div>
          <p className="text-right font-semibold">{money(period.amount_due, period.currency)}</p>
        </div>
        <div className="flex justify-between border-t border-stone-200 px-4 py-4 text-sm sm:px-5"><span className="font-semibold">Total</span><span className="font-bold">{money(period.amount_due, period.currency)}</span></div>
      </div>

      <section className="mt-8 ml-auto max-w-sm space-y-3 border-t border-stone-200 pt-5 text-sm">
        <div className="flex justify-between gap-4"><span className="text-stone-600">Invoice total</span><span>{money(period.amount_due, period.currency)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-stone-600">Payments allocated</span><span>− {money(paid, period.currency)}</span></div>
        <div className="flex justify-between gap-4 border-t border-stone-200 pt-3 text-base font-bold"><span>Balance due</span><span>{money(outstanding, period.currency)}</span></div>
      </section>

      {validAllocations.length > 0 && <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Payments received</h2>
        <div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{validAllocations.map((allocation) => <div key={allocation.payment!.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{dateLabel(allocation.payment!.paid_at)} · {allocation.payment!.payment_method.replaceAll("_", " ")}{allocation.payment!.payment_reference ? ` · Ref ${allocation.payment!.payment_reference}` : ""}</span><strong>{money(allocation.amount, period.currency)}</strong></div>)}</div>
      </section>}

      {period.status === "void" && <p className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">This billing period has been voided. This document is retained for reference only and is not payable.</p>}
      <footer className="mt-12 border-t border-stone-200 pt-5 text-xs leading-5 text-stone-500">
        <p>Thank you for choosing {settings?.company_name || "HabFarms"}.</p>
        <p className="mt-1">Please quote invoice number {invoiceNumber} when making or discussing payment.</p>
        <p className="mt-1">This invoice reflects the subscription billing period and payments allocated to it in HabFarms.</p>
      </footer>
    </Card>
  </>;
}
