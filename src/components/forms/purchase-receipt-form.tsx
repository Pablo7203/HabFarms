"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadPurchaseReceiptAction } from "@/app/actions/feed";

export function PurchaseReceiptForm({ purchaseId, sourceType = "feed_purchase" }: { purchaseId: string; sourceType?: "feed_purchase" | "raw_material_purchase" }) {
  const [message, setMessage] = useState(""), [pending, start] = useTransition();
  return <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); start(async () => { const result = await uploadPurchaseReceiptAction(sourceType, purchaseId, form); setMessage(result.message); if (result.ok) event.currentTarget.reset(); }); }}><label className="min-w-52 flex-1 text-sm font-medium">Replace receipt image<Input required name="receipt" type="file" accept="image/*,.heic,.heif" className="mt-2"/></label><Button disabled={pending}>{pending ? "Uploading…" : "Save receipt"}</Button>{message ? <p role="status" className="w-full text-sm text-stone-600">{message}</p> : null}</form>;
}
