import Link from "next/link";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Invoice = { id: string; invoice_number: string; customer_farm_name_snapshot: string; customer_email_snapshot: string; description: string; amount: number | string; currency: string; invoice_date: string; due_date: string; status: string };

export default async function PlatformInvoicesPage() {
  const { data } = await (await createClient()).from("platform_manual_invoices").select("id,invoice_number,customer_farm_name_snapshot,customer_email_snapshot,description,amount,currency,invoice_date,due_date,status").order("created_at", { ascending: false }).limit(100);
  const invoices = (data ?? []) as Invoice[];
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-emerald-800">Platform billing</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Manual invoices</h1><p className="mt-2 max-w-2xl text-stone-600">Create and download one-off customer invoices that are separate from recurring subscription billing.</p></div><Link href="/platform/invoices/new" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-900 px-4 font-semibold text-white">Create manual invoice</Link></div>
    <Card className="mt-7 overflow-hidden"><div className="hidden grid-cols-[1fr_1.2fr_1.2fr_.8fr_.8fr_.7fr] gap-3 border-b bg-stone-50 p-4 text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid"><span>Invoice</span><span>Customer</span><span>Description</span><span>Issue / due</span><span>Amount</span><span>Status</span></div>
      {invoices.map((invoice) => <Link key={invoice.id} href={`/platform/invoices/manual/${invoice.id}`} className="grid gap-2 border-b p-4 hover:bg-lime-50 md:grid-cols-[1fr_1.2fr_1.2fr_.8fr_.8fr_.7fr] md:items-center md:gap-3"><div><p className="font-semibold">{invoice.invoice_number}</p><p className="text-xs text-stone-500">{invoice.invoice_date}</p></div><p className="text-sm">{invoice.customer_farm_name_snapshot}<br /><span className="text-stone-500">{invoice.customer_email_snapshot}</span></p><p className="text-sm">{invoice.description}</p><p className="text-sm">Due {invoice.due_date}</p><p className="font-semibold">{money(invoice.amount, invoice.currency)}</p><p className={`text-sm font-semibold capitalize ${invoice.status === "void" ? "text-red-800" : "text-emerald-900"}`}>{invoice.status}</p></Link>)}
      {!invoices.length && <p className="p-8 text-sm text-stone-600">No manual invoices yet. Create one to bill a customer for a one-off item or service.</p>}
    </Card>
    {invoices.length === 100 && <p className="mt-3 text-xs text-stone-500">Showing the latest 100 invoices.</p>}
  </div>;
}
