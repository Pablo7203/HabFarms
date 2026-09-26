"use client";

import { Download } from "lucide-react";

export function PlatformInvoicePrintButton({ invoiceNumber }: { invoiceNumber: string }) {
  return <button
    type="button"
    onClick={() => {
      const previousTitle = document.title;
      document.title = invoiceNumber;
      window.print();
      window.setTimeout(() => { document.title = previousTitle; }, 1000);
    }}
    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
  >
    <Download className="size-4" aria-hidden="true" />
    Download / print PDF
  </button>;
}
