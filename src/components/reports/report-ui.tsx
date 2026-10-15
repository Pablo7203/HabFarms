import { Card } from "@/components/ui/card";

export function DateFilter({ from, to, children, exportType }: { from: string; to: string; children?: React.ReactNode; exportType?: string }) {
  return <form className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm font-medium">From<input name="from" type="date" defaultValue={from} className="mt-2 min-h-11 w-full rounded-lg border px-3" /></label><label className="text-sm font-medium">To<input name="to" type="date" defaultValue={to} className="mt-2 min-h-11 w-full rounded-lg border px-3" /></label>{children}<button className="min-h-11 self-end rounded-lg border px-4 text-sm font-semibold">Apply filters</button>{exportType && <button type="submit" name="type" value={exportType} formAction="/reports/export" formMethod="get" className="min-h-11 self-end rounded-lg border px-4 text-sm font-semibold">Export CSV</button>}</form>;
}

export function Kpis({ items }: { items: Array<[string, string | number, string?]> }) {
  return <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(([label, value, hint]) => <Card key={label} className="p-5"><p className="text-sm text-stone-500">{label}</p><p className="mt-2 break-words text-2xl font-bold">{value}</p>{hint && <p className="mt-2 text-xs text-stone-500">{hint}</p>}</Card>)}</div>;
}

export function ReportTable({ headers, rows, empty }: { headers: string[]; rows: Array<Array<React.ReactNode>>; empty: string }) {
  const primaryHeaders = headers.slice(1, 3);
  const additionalHeaders = headers.slice(3);

  return <Card className="mt-6 overflow-hidden">
    {!rows.length ? <p className="p-8 text-center text-stone-500">{empty}</p> : <>
      <div className="divide-y divide-stone-100 lg:hidden">
        {rows.map((row, rowIndex) => <article key={rowIndex} className="p-4">
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
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-stone-100"><tr>{headers.map((header) => <th scope="col" className="p-3 font-semibold" key={header}>{header}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td className="p-3 align-top" key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
    </>}
  </Card>;
}

export function SimpleChart({ title, series, unit = "" }: { title: string; series: Array<{ label: string; value: number }>; unit?: string }) {
  const max = Math.max(...series.map((item) => Math.abs(item.value)), 1);
  return <Card className="mt-6 p-5"><h2 className="font-semibold">{title}</h2>{series.length ? <div role="img" aria-label={`${title}: ${series.map((item) => `${item.label} ${item.value} ${unit}`).join(", ")}`} className="mt-5 space-y-3">{series.map((item) => <div key={item.label} className="grid grid-cols-[8rem_1fr_7rem] items-center gap-3 text-sm"><span>{item.label}</span><div className="h-5 rounded bg-stone-100"><div className="h-5 rounded bg-emerald-700" style={{ width: `${Math.max(2, Math.abs(item.value) / max * 100)}%` }} /></div><span className="text-right font-medium">{item.value.toFixed(2)}{unit && ` ${unit}`}</span></div>)}</div> : <p className="mt-5 text-sm text-stone-500">No chart data for this period.</p>}</Card>;
}
