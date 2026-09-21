import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { PurchaseReceiptForm } from "@/components/forms/purchase-receipt-form";

export default async function MaterialPurchaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: purchase }, { data: items }, { data: receipt }] = await Promise.all([
    supabase.from("raw_material_purchase_batches").select("*").eq("farm_id", context.farm.id).eq("id", id).maybeSingle(),
    supabase.from("raw_material_purchases").select("*,raw_materials(name)").eq("farm_id", context.farm.id).eq("purchase_batch_id", id).order("purchase_number"),
    supabase.from("purchase_receipts").select("*").eq("source_type", "raw_material_purchase").eq("source_id", id).maybeSingle(),
  ]);

  if (!purchase) notFound();
  const signedReceipt = receipt ? await supabase.storage.from("purchase-receipts").createSignedUrl(receipt.storage_path, 3600) : null;
  const receiptUrl = signedReceipt?.data?.signedUrl ?? null;

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-emerald-700">{purchase.purchase_number}</p><h1 className="text-3xl font-bold">Material purchase</h1><p className="mt-2 text-sm text-stone-600">{purchase.purchase_date}</p></div>
      <Link href="/feed/materials" className="inline-flex min-h-11 items-center rounded-lg border bg-white px-4 text-sm font-semibold">Back to materials</Link>
    </div>
    <div className="mt-7 grid gap-4 sm:grid-cols-3">
      {[["Total", money(Number(purchase.total_cost), context.farm.currency)], ["Paid", money(Number(purchase.amount_paid), context.farm.currency)], ["Status", purchase.status]].map(([label, value]) => <Card key={label} className="p-5"><p className="text-xs text-stone-500">{label}</p><b className="mt-2 block text-xl capitalize">{value}</b></Card>)}
    </div>
    <Card className="mt-7 overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Purchased materials</h2></div><div className="divide-y">{items?.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm"><div><p className="font-semibold">{item.raw_materials?.name}</p><p className="text-stone-600">{item.quantity_kg} kg{item.package_count ? ` · ${item.package_count} package(s)` : ""}</p></div><p className="font-semibold">{money(Number(item.total_cost), context.farm.currency)}</p></div>)}</div></Card>
    <Card className="mt-7 p-6"><h2 className="font-semibold">Receipt evidence</h2><p className="mt-1 text-sm text-stone-600">Keep a photo of the cash or bank receipt with this purchase for audit and reconciliation.</p>{receiptUrl ? <a href={receiptUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">View {receipt?.file_name}</a> : <p className="mt-4 text-sm text-stone-500">No receipt image has been attached.</p>}<PurchaseReceiptForm purchaseId={id} sourceType="raw_material_purchase" /></Card>
  </div>;
}
