import Link from "next/link";
export const PAGE_SIZES = [20, 40, 50, 100, 500] as const;
export const PAGE_SIZE = 50;
export function pageWindow(value?: string, requestedSize?: string) {
  const requestedPage = Number(value);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage) || 1) : 1;
  const parsedSize = Number(requestedSize);
  const pageSize = PAGE_SIZES.includes(parsedSize as (typeof PAGE_SIZES)[number])
    ? parsedSize
    : PAGE_SIZE;
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}
export function Pagination({
  page,
  pageSize = PAGE_SIZE,
  hasMore,
  base,
  params = {},
}: {
  page: number;
  pageSize?: number;
  hasMore: boolean;
  base: string;
  params?: Record<string, string | undefined>;
}) {
  const href = (target: number) =>
    `${base}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), pageSize: String(pageSize), page: String(target) }).toString()}`;
  return (
    <nav
      aria-label="Pagination"
      className="mt-5 flex items-center justify-between"
    >
      <Link
        aria-disabled={page === 1}
        href={page === 1 ? href(1) : href(page - 1)}
        className="min-h-11 rounded-lg border bg-white px-4 py-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        Previous
      </Link>
      <span className="text-sm">Page {page}</span>
      <Link
        aria-disabled={!hasMore}
        href={hasMore ? href(page + 1) : href(page)}
        className="min-h-11 rounded-lg border bg-white px-4 py-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        Next
      </Link>
    </nav>
  );
}
