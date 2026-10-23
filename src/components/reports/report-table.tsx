"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";

export function ReportTable({ headers, rows, empty, paginate = true }: { headers: string[]; rows: Array<Array<React.ReactNode>>; empty: string; paginate?: boolean }) {
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = paginate ? rows.slice((currentPage - 1) * pageSize, currentPage * pageSize) : rows;
  const primaryHeaders = headers.slice(1, 3);
  const additionalHeaders = headers.slice(3);

  return <Card className="mt-6 overflow-hidden">
    {!rows.length ? <p className="p-8 text-center text-stone-500">{empty}</p> : <>
      {paginate && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-4 py-3 sm:px-5">
        <p className="text-sm text-stone-600">Showing {Math.min((currentPage - 1) * pageSize + 1, rows.length)}–{Math.min(currentPage * pageSize, rows.length)} of {rows.length} rows</p>
        <label className="flex items-center gap-2 text-sm font-medium text-stone-700">Rows per page<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="min-h-10 rounded-lg border border-stone-200 bg-white px-3">
          {[20, 40, 50, 100, 500].map((size) => <option key={size} value={size}>{size} rows</option>)}
        </select></label>
      </div>}
      <div className="divide-y divide-stone-100 lg:hidden">
        {visibleRows.map((row, rowIndex) => <article key={(currentPage - 1) * pageSize + rowIndex} className="p-4">
          <h3 className="break-words text-sm font-semibold text-stone-900">{row[0] ?? "Record"}</h3>
          {primaryHeaders.length ? <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
            {primaryHeaders.map((header, index) => <div key={header} className="min-w-0"><dt className="text-xs text-stone-500">{header}</dt><dd className="mt-1 break-words text-sm font-medium">{row[index + 1] ?? "Not available"}</dd></div>)}
          </dl> : null}
          {additionalHeaders.length ? <details className="mt-3 border-t border-stone-100 pt-3">
            <summary className="min-h-8 cursor-pointer text-sm font-semibold text-emerald-800">More details</summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-3">
              {additionalHeaders.map((header, index) => <div key={header} className="min-w-0"><dt className="text-xs text-stone-500">{header}</dt><dd className="mt-1 break-words text-sm">{row[index + 3] ?? "Not available"}</dd></div>)}
            </dl>
          </details> : null}
        </article>)}
      </div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-stone-100"><tr>{headers.map((header) => <th scope="col" className="p-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y">{visibleRows.map((row, rowIndex) => <tr key={(currentPage - 1) * pageSize + rowIndex}>{row.map((cell, cellIndex) => <td className="p-3 align-top" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
      {paginate && pageCount > 1 && <nav aria-label="Report table pagination" className="flex items-center justify-between border-t border-stone-100 p-3">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
        <span className="text-sm text-stone-600">Page {currentPage} of {pageCount}</span>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="min-h-10 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button>
      </nav>}
    </>}
  </Card>;
}
