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

export function GradeBreakdown({ title, rows, currency, pricing = false }: { title: string; rows: JsonRecord[]; currency: string; pricing?: boolean }) {
  return <Card className="mt-6 overflow-hidden"><div className="border-b border-stone-200 p-5"><h2 className="font-semibold">{title}</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-stone-50"><tr><th className="p-3">Grade</th><th className="p-3 text-right">Eggs</th>{pricing ? <><th className="p-3 text-right">Current price / crate</th><th className="p-3 text-right">Operating margin / crate</th><th className="p-3 text-right">Operating margin</th></> : <><th className="p-3 text-right">Crates</th><th className="p-3 text-right">Loose</th></>}</tr></thead><tbody>{rows.map((row) => <tr className="border-t border-stone-100" key={String(row.code)}><td className="p-3 font-medium">{String(row.name)}</td><td className="p-3 text-right">{number(row.eggs).toLocaleString()}</td>{pricing ? <><td className="p-3 text-right">{row.crate_price == null ? "Not set" : money(number(row.crate_price), currency)}</td><td className="p-3 text-right">{row.margin_per_crate == null ? "Not available" : money(number(row.margin_per_crate), currency)}</td><td className="p-3 text-right">{row.margin_percentage == null ? "Not available" : `${number(row.margin_percentage).toFixed(2)}%`}</td></> : <><td className="p-3 text-right">{number(row.crates).toLocaleString()}</td><td className="p-3 text-right">{number(row.loose_eggs).toLocaleString()}</td></>}</tr>)}</tbody></table></div>{rows.length === 0 ? <p className="p-6 text-sm text-stone-500">No records for this period.</p> : null}</Card>;
}
