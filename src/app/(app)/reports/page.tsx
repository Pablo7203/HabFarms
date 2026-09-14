import Link from "next/link";
import { requireAppContext } from "@/lib/auth/context";
import { Card } from "@/components/ui/card";

export default async function Reports() {
  const context = await requireAppContext();
  const financial = context.membership.role !== "worker";
  const items = [
    ["/reports/daily-summary", "Daily summary", "Traceable birds, production, inventory, and feed for one farm day"],
    ["/reports/weekly-summary", "Weekly summary", "Performance, completeness, costs, and unit economics"],
    ["/reports/production", "Production report", "Egg output, flock performance, and feed efficiency"],
    ["/reports/feed", "Feed report", "Purchases, consumption, wastage, and current stock"],
    ["/reports/health", "Health report", "Treatment activity and upcoming care"],
    ...(financial ? [["/reports/sales", "Sales report", "Revenue, collections, and receivables"], ["/reports/expenses", "Expense report", "Incurred costs, payments, and payables"], ["/reports/profitability", "Profitability", "Management operating profit"], ["/cash-flow", "Cash flow", "Inflows, outflows, and tracked balance"]] : []),
  ] as Array<[string, string, string]>;
  return <div><h1 className="text-3xl font-bold">Reports</h1><p className="mt-2 text-stone-600">Transaction-derived farm performance for daily, weekly, monthly, annual, or custom periods.</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{items.map(([path, title, description]) => <Link key={title} href={path}><Card className="h-full p-5"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-stone-600">{description}</p></Card></Link>)}</div></div>;
}
