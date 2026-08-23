import Link from "next/link";
import { requireAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { money } from "@/lib/reporting";
import { Card } from "@/components/ui/card";

export default async function Dashboard() {
  const context = await requireAppContext();
  const supabase = await createClient();
  const today = farmToday(context.farm.timezone);
  const start = `${today.slice(0, 8)}01`;
  const financial = context.membership.role !== "worker";
  const [flocks, production, inventory, health, upcoming, sales, customers, feed, expenses, profit, cash] = await Promise.all([
    supabase.from("v_current_flock_status").select("current_live_birds").eq("farm_id", context.farm.id).eq("status", "active"),
    supabase.from("v_daily_production_metrics").select("good_eggs").eq("farm_id", context.farm.id).eq("production_date", today),
    supabase.from("v_current_egg_inventory").select("current_eggs").eq("farm_id", context.farm.id).maybeSingle(),
    supabase.from("health_records").select("id").eq("farm_id", context.farm.id).eq("status", "active").gte("record_date", financial ? start : today).lte("record_date", today),
    supabase.from("v_upcoming_health_actions").select("id,next_due_date,product_name").eq("farm_id", context.farm.id).gte("next_due_date", today).order("next_due_date").limit(5),
    financial ? supabase.from("sales").select("total_amount").eq("farm_id", context.farm.id).eq("status", "completed").gte("sale_date", start).lte("sale_date", today) : Promise.resolve({ data: [] }),
    financial ? supabase.from("v_customer_balances").select("outstanding_balance").eq("farm_id", context.farm.id) : Promise.resolve({ data: [] }),
    financial ? supabase.from("v_feed_purchase_receivables").select("outstanding_balance").eq("farm_id", context.farm.id).eq("status", "completed") : Promise.resolve({ data: [] }),
    financial ? supabase.from("v_expense_payables").select("outstanding_balance").eq("farm_id", context.farm.id) : Promise.resolve({ data: [] }),
    financial ? supabase.rpc("get_profitability_summary", { start_date: start, end_date: today }) : Promise.resolve({ data: [] }),
    financial ? supabase.rpc("get_cash_flow_summary", { start_date: start, end_date: today }) : Promise.resolve({ data: [] }),
  ]);
  const sum = (rows: Array<Record<string, unknown>> | null | undefined, field: string) => rows?.reduce((total, row) => total + Number(row[field] ?? 0), 0) ?? 0;
  const cards: Array<[string, string | number, string]> = [
    ["Live birds", sum(flocks.data, "current_live_birds"), "Active flocks"],
    ["Good eggs today", sum(production.data, "good_eggs"), today],
    ["Eggs in stock", Number(inventory.data?.current_eggs ?? 0), "Current derived inventory"],
    [financial ? "Health records this month" : "Health records today", health.data?.length ?? 0, `${upcoming.data?.length ?? 0} upcoming actions`],
  ];
  if (financial) cards.push(
    ["Sales revenue this month", money(sum(sales.data, "total_amount"), context.farm.currency), "Revenue, not cash received"],
    ["Operating profit this month", money(profit.data?.[0]?.operating_profit, context.farm.currency), "Revenue less feed usage, wastage and other expenses"],
    ["Customer receivables", money(sum(customers.data, "outstanding_balance"), context.farm.currency), "Outstanding completed sales"],
    ["Supplier and expense payables", money(sum(feed.data, "outstanding_balance") + sum(expenses.data, "outstanding_balance"), context.farm.currency), "Recorded unpaid obligations"],
    ["Tracked cash balance", money(cash.data?.[0]?.closing_balance, context.farm.currency), "System-tracked balance, not bank reconciliation"],
  );
  return <div><p className="text-sm font-medium text-emerald-700">{today}</p><h1 className="mt-1 text-3xl font-bold">{context.farm.name}</h1><p className="mt-2 text-stone-600">Today’s operational position from recorded transactions.</p><div className="mt-6 flex flex-wrap gap-3"><Link href="/production/new" className="min-h-11 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">Record production</Link><Link href="/health/new" className="min-h-11 rounded-lg border bg-white px-4 py-3 text-sm font-semibold">Record health</Link>{financial && <><Link href="/expenses/new" className="min-h-11 rounded-lg border bg-white px-4 py-3 text-sm font-semibold">New expense</Link><Link href="/reports" className="min-h-11 rounded-lg border bg-white px-4 py-3 text-sm font-semibold">View reports</Link></>}</div><div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, note]) => <Card key={label} className="p-5"><p className="text-sm text-stone-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p><p className="mt-2 text-xs text-stone-500">{note}</p></Card>)}</div>{upcoming.data?.length ? <Card className="mt-7 p-5"><h2 className="font-semibold">Upcoming health actions</h2>{upcoming.data.map(item => <p key={item.id} className="mt-3 border-t pt-3 text-sm">{item.next_due_date} · {item.product_name}</p>)}</Card> : null}</div>;
}
