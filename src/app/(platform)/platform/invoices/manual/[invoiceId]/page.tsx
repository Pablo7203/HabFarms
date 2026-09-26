import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PlatformInvoicePrintButton } from "@/components/forms/platform-invoice-print-button";
import { PlatformManualInvoiceVoidForm } from "@/components/forms/platform-manual-invoice-form";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

type ManualInvoice = {
  id: string; invoice_number: string; customer_farm_name_snapshot: string; customer_contact_name_snapshot: string;
  customer_email_snapshot: string; customer_phone_snapshot: string | null; customer_country_snapshot: string | null;
  issuer_name_snapshot: string; issuer_billing_email_snapshot: string | null; issuer_support_email_snapshot: string | null;
  issuer_phone_snapshot: string | null; description: string; amount: number | string; currency: string;
  invoice_date: string; due_date: string; status: "issued" | "void"; void_reason: string | null;
};

function dateLabel(value: string) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`)); }

export default async function ManualInvoiceDetail({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const { data, error } = await (await createClient()).from("platform_manual_invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error || !data) notFound();
  const invoice = data as ManualInvoice;
  return <>
    <style>{`@page{size:A4;margin:16mm}@media print{body *{visibility:hidden!important}.platform-invoice-document,.platform-invoice-document *{visibility:visible!important}.platform-invoice-document{position:fixed!important;inset:0!important;z-index:9999!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important}.invoice-actions,.invoice-admin-controls{display:none!important}.invoice-paper{border:0!important;padding:0!important}}`}</style>
    <div className="invoice-actions mx-auto mb-5 flex max-w-4xl flex-wrap items-center justify-between gap-3"><Link href="/platform/invoices" className="text-sm font-semibold text-emerald-900">← Manual invoices</Link><PlatformInvoicePrintButton invoiceNumber={invoice.invoice_number} /></div>
    <Card className="platform-invoice-document invoice-paper mx-auto max-w-4xl border-stone-200 bg-white p-6 shadow-sm sm:p-10">
      <div className="flex flex-wrap justify-between gap-8 border-b border-stone-200 pb-8"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">{invoice.issuer_name_snapshot}</p><h1 className="mt-3 text-4xl font-bold tracking-tight">Invoice</h1><p className="mt-2 text-sm text-stone-500">One-time charge</p></div><dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 self-end text-sm"><dt className="text-stone-500">Invoice no.</dt><dd className="font-semibold">{invoice.invoice_number}</dd><dt className="text-stone-500">Issued</dt><dd>{dateLabel(invoice.invoice_date)}</dd><dt className="text-stone-500">Due date</dt><dd>{dateLabel(invoice.due_date)}</dd><dt className="text-stone-500">Status</dt><dd className="font-semibold capitalize">{invoice.status}</dd></dl></div>
      <div className="grid gap-8 py-8 sm:grid-cols-2"><section><h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Bill to</h2><p className="mt-3 text-lg font-semibold">{invoice.customer_farm_name_snapshot}</p><p className="mt-1 text-sm">{invoice.customer_contact_name_snapshot}</p><p className="mt-1 text-sm">{invoice.customer_email_snapshot}</p>{invoice.customer_phone_snapshot && <p className="mt-1 text-sm">{invoice.customer_phone_snapshot}</p>}{invoice.customer_country_snapshot && <p className="mt-1 text-sm">{invoice.customer_country_snapshot}</p>}</section><section><h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">From</h2><p className="mt-3 text-lg font-semibold">{invoice.issuer_name_snapshot}</p>{invoice.issuer_billing_email_snapshot && <p className="mt-1 text-sm">Billing: {invoice.issuer_billing_email_snapshot}</p>}{invoice.issuer_support_email_snapshot && <p className="mt-1 text-sm">Support: {invoice.issuer_support_email_snapshot}</p>}{invoice.issuer_phone_snapshot && <p className="mt-1 text-sm">{invoice.issuer_phone_snapshot}</p>}</section></div>
      <div className="overflow-hidden rounded-xl border border-stone-200"><div className="grid grid-cols-[1fr_auto] gap-4 bg-stone-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500 sm:px-5"><span>Description</span><span className="text-right">Amount</span></div><div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-5 sm:px-5"><p className="font-medium">{invoice.description}</p><p className="text-right font-semibold">{money(invoice.amount, invoice.currency)}</p></div><div className="flex justify-between border-t border-stone-200 px-4 py-4 text-sm sm:px-5"><span className="font-semibold">Total</span><span className="font-bold">{money(invoice.amount, invoice.currency)}</span></div></div>
      <div className="mt-8 ml-auto max-w-sm border-t border-stone-200 pt-5"><div className="flex justify-between gap-4 text-base font-bold"><span>Invoice total</span><span>{money(invoice.amount, invoice.currency)}</span></div></div>
      {invoice.status === "void" && <p className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">VOID — this invoice is retained for reference only and is not payable.</p>}
      <footer className="mt-12 border-t border-stone-200 pt-5 text-xs leading-5 text-stone-500"><p>Thank you for choosing {invoice.issuer_name_snapshot}.</p><p className="mt-1">Please quote invoice number {invoice.invoice_number} when making or discussing payment.</p></footer>
    </Card>
    {invoice.status === "void" && invoice.void_reason && <p className="invoice-admin-controls mx-auto mt-3 max-w-4xl text-sm text-stone-600"><span className="font-semibold">Internal void reason:</span> {invoice.void_reason}</p>}
    {invoice.status === "issued" && <div className="invoice-admin-controls mx-auto max-w-4xl"><PlatformManualInvoiceVoidForm invoiceId={invoice.id} /></div>}
  </>;
}
