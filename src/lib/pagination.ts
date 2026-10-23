export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Read a bounded-size database page repeatedly until the result is exhausted. */
export async function readAllPages<T>(
  fetchPage: (start: number, end: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("Invalid export page size");
  const rows: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const page = await fetchPage(start, start + pageSize - 1);
    if (page.error) throw new Error("Export query failed");
    const current = page.data ?? [];
    rows.push(...current);
    if (current.length < pageSize) return rows;
  }
}
