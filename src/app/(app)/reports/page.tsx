import Link from "next/link";
import { ArrowUpRight, BarChart3, CalendarDays, ChartColumnBig, Egg, HeartPulse, ReceiptText, Wheat, Bird } from "lucide-react";
import { requireAppContext } from "@/lib/auth/context";
import { Card } from "@/components/ui/card";

const reportIcons = { "Daily summary": CalendarDays, "Weekly summary": ChartColumnBig, "Production report": Egg, "Feed report": Wheat, "Health report": HeartPulse, "Sales report": ReceiptText, "Bird sales report": Bird, "Expense report": ReceiptText, Profitability: BarChart3, "Cash flow": BarChart3 };

export default async function Reports() {
  const context = await requireAppContext();
  const financial = context.membership.role !== "worker";
  const items = [
    ["/reports/daily-summary", "Daily summary", "Traceable birds, production, inventory, and feed for one farm day"],
    ["/reports/weekly-summary", "Weekly summary", "Performance, completeness, costs, and unit economics"],
    ["/reports/production", "Production report", "Egg output, flock performance, and feed efficiency"],
    ["/reports/feed", "Feed report", "Purchases, consumption, wastage, and current stock"],
    ["/reports/health", "Health report", "Treatment activity and upcoming care"],
    ...(financial ? [["/reports/sales", "Sales report", "Revenue, collections, and receivables"], ["/reports/bird-sales", "Bird sales report", "Flock sell-offs, prices, revenue, and categories"], ["/reports/expenses", "Expense report", "Incurred costs, payments, and payables"], ["/reports/profitability", "Profitability", "Management operating profit"], ["/cash-flow", "Cash flow", "Inflows, outflows, and tracked balance"]] : []),
  ] as Array<[string, keyof typeof reportIcons, string]>;
  const operational = items.slice(0, 5);
  const financialReports = items.slice(5);

  const reportGrid = (reports: typeof items) => <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{reports.map(([path, title, description]) => {
    const Icon = reportIcons[title];
    return <Link key={title} href={path} className="group"><Card className="h-full p-5 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"><div className="flex items-start justify-between gap-4"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Icon size={20}/></span><ArrowUpRight size={18} className="text-stone-400 transition group-hover:text-emerald-800"/></div><h2 className="mt-6 font-semibold text-stone-950">{title}</h2><p className="mt-2 text-sm leading-6 text-stone-600">{description}</p><p className="mt-5 text-sm font-semibold text-emerald-800">Open report</p></Card></Link>;
  })}</div>;

  return <div className="space-y-8">
    <div className="max-w-3xl"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Performance intelligence</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Reports</h1><p className="mt-3 text-stone-600">Transaction-derived views of the farm. Choose a report to filter the period and investigate the records behind each result.</p></div>
    <section><div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xl font-bold">Farm operations</h2><p className="mt-1 text-sm text-stone-500">Daily and weekly operating performance.</p></div></div>{reportGrid(operational)}</section>
    {financialReports.length > 0 && <section><div className="mb-4"><h2 className="text-xl font-bold">Finance</h2><p className="mt-1 text-sm text-stone-500">Commercial reports available to your role.</p></div>{reportGrid(financialReports)}</section>}
  </div>;
}
