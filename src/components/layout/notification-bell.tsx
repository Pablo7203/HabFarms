"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Bell, CircleAlert, HeartPulse, Wheat, WalletCards, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatFeedRunway } from "@/lib/feed-forecast";

type Alert = { id: string; title: string; detail: string; href: string; kind: "feed" | "health" | "finance" };
const money = (value: unknown, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value ?? 0));

export function NotificationBell({ farmId, role, currency }: { farmId: string; role: string; currency: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]), [open, setOpen] = useState(false), titleId = useId();
  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const financial = role !== "worker";
      const [feed, health, collections, payables] = await Promise.all([
        supabase.from("v_feed_forecast").select("feed_type_id,feed_type_name,quantity_kg,days_remaining,alert_level").eq("farm_id", farmId).in("alert_level", ["warning", "critical", "out_of_stock"]),
        supabase.from("v_health_reminder_status").select("id,title,flock_name,due_date,reminder_status").eq("farm_id", farmId).eq("status", "active").in("reminder_status", ["overdue", "due_today"]),
        financial ? supabase.from("v_credit_collections").select("sale_id,customer_name,outstanding_balance,collection_status").eq("farm_id", farmId).gt("outstanding_balance", 0).in("collection_status", ["overdue", "due_today"]) : Promise.resolve({ data: [] }),
        financial ? supabase.from("v_supplier_payables").select("id,supplier_name,outstanding_balance,supplier_due_status").eq("farm_id", farmId).gt("outstanding_balance", 0).in("supplier_due_status", ["overdue", "due_today"]) : Promise.resolve({ data: [] }),
      ]);
      const next: Alert[] = [
        ...(feed.data ?? []).map((item) => ({ id: `feed-${item.feed_type_id}`, title: item.alert_level === "out_of_stock" ? `${item.feed_type_name} is out of stock` : `${item.feed_type_name} is running low`, detail: `${Number(item.quantity_kg).toLocaleString()} kg available · ${formatFeedRunway(item.days_remaining==null?null:Number(item.days_remaining),Number(item.quantity_kg))}`, href: "/feed/planning", kind: "feed" as const })),
        ...(health.data ?? []).map((item) => ({ id: `health-${item.id}`, title: item.title, detail: `${item.flock_name} · ${String(item.reminder_status).replaceAll("_", " ")}`, href: "/health/reminders", kind: "health" as const })),
        ...(collections.data ?? []).map((item) => ({ id: `collection-${item.sale_id}`, title: `${item.customer_name ?? "Customer"} payment ${String(item.collection_status).replaceAll("_", " ")}`, detail: money(item.outstanding_balance, currency), href: "/collections", kind: "finance" as const })),
        ...(payables.data ?? []).map((item) => ({ id: `payable-${item.id}`, title: `${item.supplier_name ?? "Supplier"} payment ${String(item.supplier_due_status).replaceAll("_", " ")}`, detail: money(item.outstanding_balance, currency), href: "/payables", kind: "finance" as const })),
      ];
      setAlerts(next);
      const key = `habfarms-alerts-opened:${farmId}`;
      if (next.length && !sessionStorage.getItem(key)) { setOpen(true); sessionStorage.setItem(key, "1"); }
    };
    void load();
  }, [currency, farmId, role]);
  const Icon = ({ kind }: { kind: Alert["kind"] }) => kind === "feed" ? Wheat : kind === "health" ? HeartPulse : WalletCards;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={`Open notifications${alerts.length ? ` (${alerts.length})` : ""}`} className="relative grid size-11 place-items-center rounded-xl text-stone-700 hover:bg-stone-100">
      <Bell size={20} />{alerts.length ? <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">{alerts.length > 9 ? "9+" : alerts.length}</span> : null}
    </button>
    {open ? <div className="fixed inset-0 z-[60] grid place-items-center bg-stone-950/35 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-xl overflow-auto rounded-2xl border border-stone-200 bg-[#fffefb] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-emerald-700">Farm alerts</p><h2 id={titleId} className="mt-1 text-xl font-bold text-stone-950">{alerts.length ? "Items that need attention" : "You’re all caught up"}</h2></div><button autoFocus aria-label="Close notifications" onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-lg hover:bg-stone-100"><X size={19}/></button></div>{alerts.length ? <div className="mt-5 space-y-3">{alerts.map((alert) => { const AlertIcon = Icon({ kind: alert.kind }); return <Link key={alert.id} href={alert.href} onClick={() => setOpen(false)} className="flex gap-3 rounded-xl border border-stone-200 p-4 hover:border-emerald-300 hover:bg-emerald-50"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><AlertIcon size={19}/></span><span><strong className="block text-sm text-stone-900">{alert.title}</strong><span className="mt-1 block text-sm text-stone-600">{alert.detail}</span></span></Link>; })}</div> : <div className="mt-5 rounded-xl bg-stone-50 p-5 text-sm text-stone-600"><CircleAlert className="mb-2 text-emerald-700" size={20}/>No urgent feed, health, collection, or supplier-payment alerts right now.</div>}</section></div> : null}
  </>;
}
