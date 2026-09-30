import Link from "next/link";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/format";

export type JsonRecord = Record<string, unknown>;
export const number = (value: unknown) => Number(value ?? 0);
export const records = (value: unknown) => Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object") : [];

export function SummaryCard({ label, value, href, detail }: { label: string; value: string | number; href?: string; detail?: string }) {
  const body = <Card className="h-full p-5 transition-colors hover:border-emerald-300"><p className="text-sm text-stone-600">{label}</p><p className="mt-2 text-2xl font-bold text-stone-950">{value}</p>{detail ? <p className="mt-2 text-xs text-stone-500">{detail}</p> : null}</Card>;
  return href ? <Link aria-label={`View source records for ${label}`} href={href}>{body}</Link> : body;
}

export function GradeBreakdown({ title, rows, currency, pricing = false, mix = false }: { title: string; rows: JsonRecord[]; currency: string; pricing?: boolean; mix?: boolean }) {
  const columns = pricing
    ? ["Eggs", "Current price / crate", "Operating margin / crate", "Operating margin"]
    : mix
      ? ["Eggs", "Share of saleable production"]
      : ["Eggs", "Crates", "Loose"];
  const values = (row: JsonRecord): Array<string> => pricing
    ? [number(row.eggs).toLocaleString(), row.crate_price == null ? "Not set" : money(number(row.crate_price), currency), row.margin_per_crate == null ? "Not available" : money(number(row.margin_per_crate), currency), row.margin_percentage == null ? "Not available" : `${number(row.margin_percentage).toFixed(2)}%`]
    : mix
      ? [number(row.eggs).toLocaleString(), `${number(row.share_percentage).toFixed(2)}%`]
      : [number(row.eggs).toLocaleString(), number(row.crates).toLocaleString(), number(row.loose_eggs).toLocaleString()];

  return <Card className="mt-6 overflow-hidden">
    <div className="border-b border-stone-200 p-5"><h2 className="font-semibold">{title}</h2></div>
    {rows.length ? <>
      <div className="divide-y divide-stone-100 lg:hidden">{rows.map((row) => <article key={String(row.code)} className="p-4">
        <h3 className="text-sm font-semibold">{String(row.name)}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">{columns.map((label, index) => <div key={label}><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{values(row)[index]}</dd></div>)}</dl>
      </article>)}</div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-stone-50"><tr><th scope="col" className="p-3">Grade</th>{columns.map((column) => <th scope="col" className="p-3 text-right" key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row) => <tr className="border-t border-stone-100" key={String(row.code)}><td className="p-3 font-medium">{String(row.name)}</td>{values(row).map((value, index) => <td className="p-3 text-right" key={columns[index]}>{value}</td>)}</tr>)}</tbody></table></div>
    </> : <p className="p-6 text-sm text-stone-500">No records for this period.</p>}
  </Card>;
}
