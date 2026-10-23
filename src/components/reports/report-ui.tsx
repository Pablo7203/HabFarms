import { Card } from "@/components/ui/card";

export { ReportTable } from "@/components/reports/report-table";

export function DateFilter({ from, to, children, exportType }: { from: string; to: string; children?: React.ReactNode; exportType?: string }) {
  return <form className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm font-medium">From<input name="from" type="date" defaultValue={from} className="mt-2 min-h-11 w-full rounded-lg border px-3" /></label><label className="text-sm font-medium">To<input name="to" type="date" defaultValue={to} className="mt-2 min-h-11 w-full rounded-lg border px-3" /></label>{children}<button className="min-h-11 self-end rounded-lg border px-4 text-sm font-semibold">Apply filters</button>{exportType && <button type="submit" name="report" value={exportType} formAction="/reports/export" formMethod="get" className="min-h-11 self-end rounded-lg border px-4 text-sm font-semibold">Export CSV</button>}</form>;
}

export function Kpis({ items }: { items: Array<[string, string | number, string?]> }) {
  return <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(([label, value, hint]) => <Card key={label} className="p-5"><p className="text-sm text-stone-500">{label}</p><p className="mt-2 break-words text-2xl font-bold">{value}</p>{hint && <p className="mt-2 text-xs text-stone-500">{hint}</p>}</Card>)}</div>;
}

export function SimpleChart({ title, series, unit = "" }: { title: string; series: Array<{ label: string; value: number }>; unit?: string }) {
  const max = Math.max(...series.map((item) => Math.abs(item.value)), 1);
  return <Card className="mt-6 p-5"><h2 className="font-semibold">{title}</h2>{series.length ? <div role="img" aria-label={`${title}: ${series.map((item) => `${item.label} ${item.value} ${unit}`).join(", ")}`} className="mt-5 space-y-3">{series.map((item) => <div key={item.label} className="grid grid-cols-[8rem_1fr_7rem] items-center gap-3 text-sm"><span>{item.label}</span><div className="h-5 rounded bg-stone-100"><div className="h-5 rounded bg-emerald-700" style={{ width: `${Math.max(2, Math.abs(item.value) / max * 100)}%` }} /></div><span className="text-right font-medium">{item.value.toFixed(2)}{unit && ` ${unit}`}</span></div>)}</div> : <p className="mt-5 text-sm text-stone-500">No chart data for this period.</p>}</Card>;
}
