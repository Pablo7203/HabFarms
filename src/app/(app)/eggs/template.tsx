"use client";

import { useSearchParams } from "next/navigation";

export default function EggsTemplate({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const openingRecorded = searchParams.get("opening") === "recorded";

  return (
    <>
      {openingRecorded ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          Opening egg stock was recorded successfully.
        </div>
      ) : null}
      {children}
    </>
  );
}
