import Image from "next/image";

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`motion-safe:animate-pulse rounded-xl bg-[#e7eddf] motion-reduce:animate-none ${className}`}
    />
  );
}

export default function Loading() {
  return (
    <section
      aria-label="Loading farm workspace"
      aria-busy="true"
      role="status"
      className="min-h-[55vh]"
    >
      <span className="sr-only">Loading your farm workspace</span>

      <div className="flex items-center gap-3 rounded-2xl border border-[#e3e8de] bg-[#fffefb] p-4 shadow-[0_16px_38px_-32px_rgba(49,77,35,0.34)] sm:p-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#f2f8e5]">
          <Image
            src="/brand/habfarms-icon-small.svg"
            alt=""
            width={38}
            height={38}
            unoptimized
            priority
          />
        </span>
        <div>
          <p className="text-sm font-semibold text-[#315d17]">
            Loading your farm workspace
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Getting the latest farm records ready.
          </p>
        </div>
      </div>

      <div aria-hidden="true" className="mt-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e3e8de] pb-5">
          <div className="w-full max-w-lg space-y-3">
            <Skeleton className="h-3 w-28 rounded-md" />
            <Skeleton className="h-9 w-64 max-w-full rounded-lg" />
            <Skeleton className="h-4 w-full max-w-md rounded-md" />
          </div>
          <Skeleton className="h-11 w-36" />
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="rounded-[var(--farm-card-radius)] border border-[#e3e8de] bg-[#fffefb] p-4 sm:p-5"
            >
              <Skeleton className="h-3 w-24 rounded-md" />
              <Skeleton className="mt-5 h-8 w-32 max-w-full rounded-lg" />
              <Skeleton className="mt-3 h-3 w-40 max-w-full rounded-md" />
            </div>
          ))}
        </div>

        <div className="rounded-[var(--farm-card-radius)] border border-[#e3e8de] bg-[#fffefb] p-4 sm:p-6">
          <Skeleton className="h-5 w-48 max-w-full rounded-md" />
          <div className="mt-5 divide-y divide-[#eef1eb]">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-44 max-w-full rounded-md" />
                  <Skeleton className="h-3 w-64 max-w-full rounded-md" />
                </div>
                <Skeleton className="h-5 w-20 shrink-0 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
