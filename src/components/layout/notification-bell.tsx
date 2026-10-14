"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Bell, CircleAlert, HeartPulse, Wheat, WalletCards, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatFeedRunway } from "@/lib/feed-forecast";
import { lifecycleMilestones, type BirdPurpose } from "@/lib/rearing-lifecycle";

type Alert = { id: string; title: string; detail: string; href: string; kind: "feed" | "health" | "finance" | "lifecycle" };
const money = (value: unknown, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value ?? 0));
const dateInZone = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find(p=>p.type==="year")?.value}-${parts.find(p=>p.type==="month")?.value}-${parts.find(p=>p.type==="day")?.value}`;
};
const plusDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };

export function NotificationBell({ farmId, role, currency, timezone }: { farmId: string; role: string; currency: string; timezone: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]), [open, setOpen] = useState(false), titleId = useId();
  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const financial = role !== "worker";
      const [feed, health, collections, payables, batches] = await Promise.all([
        supabase.from("v_feed_forecast").select("feed_type_id,feed_type_name,quantity_kg,days_remaining,alert_level").eq("farm_id", farmId).in("alert_level", ["warning", "critical", "out_of_stock"]),
        supabase.from("v_health_reminder_status").select("id,title,flock_name,due_date,reminder_status").eq("farm_id", farmId).eq("status", "active").in("reminder_status", ["overdue", "due_today"]),
        financial ? supabase.from("v_credit_collections").select("sale_id,customer_name,outstanding_balance,collection_status").eq("farm_id", farmId).gt("outstanding_balance", 0).in("collection_status", ["overdue", "due_today"]) : Promise.resolve({ data: [] }),
        financial ? supabase.from("v_supplier_payables").select("id,supplier_name,outstanding_balance,supplier_due_status").eq("farm_id", farmId).gt("outstanding_balance", 0).in("supplier_due_status", ["overdue", "due_today"]) : Promise.resolve({ data: [] }),
        supabase.from("v_rearing_population").select("batch_id,batch_code,bird_purpose,arrival_date,hatch_date,stage,status").eq("farm_id",farmId).in("status",["active","partially_transferred"]).limit(100),
      ]);
      const today=dateInZone(new Date(),timezone);
      const lifecycleAlerts:Alert[]=[];
      const activeBatches = (batches.data ?? []) as Array<{batch_id:string;batch_code:string;bird_purpose:BirdPurpose;arrival_date:string;hatch_date:string|null;stage:string;status:string}>;
      for(const batch of activeBatches) for(const milestone of lifecycleMilestones(batch.bird_purpose)) {
        const ageBase=batch.hatch_date??batch.arrival_date;
        const due=plusDays(ageBase,milestone.day),daysUntil=Math.round((Date.parse(`${due}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000);
        const stageAlreadyPassed=batch.bird_purpose==="broiler"
          ? (milestone.key==="starter-review"&&["finishing","ready_for_market"].includes(batch.stage)) || (milestone.key==="grower-review"&&batch.stage==="ready_for_market")
          : (milestone.key==="brooding-review"&&batch.stage!=="brooding") || (milestone.key==="prelay-review"&&batch.stage==="ready_for_transfer");
        if(stageAlreadyPassed||daysUntil < -7||daysUntil>7) continue;
        const timing=daysUntil<0?`${Math.abs(daysUntil)} days overdue`:daysUntil===0?"due today":`in ${daysUntil} days`;
        lifecycleAlerts.push({id:`lifecycle-${batch.batch_id}-${milestone.key}`,title:`${batch.batch_code}: ${milestone.title}`,detail:`${timing} · ${batch.hatch_date?"Age based on recorded hatch date. ":"Age based on arrival because hatch date is not recorded. "}${milestone.detail}`,href:`/rearing/${batch.batch_id}`,kind:"lifecycle"});
      }
      const next: Alert[] = [
        ...((feed.data ?? []) as Array<{feed_type_id:string;feed_type_name:string;quantity_kg:number;days_remaining:number|null;alert_level:string}>).map((item) => ({ id: `feed-${item.feed_type_id}`, title: item.alert_level === "out_of_stock" ? `${item.feed_type_name} is out of stock` : `${item.feed_type_name} is running low`, detail: `${Number(item.quantity_kg).toLocaleString()} kg available · ${formatFeedRunway(item.days_remaining==null?null:Number(item.days_remaining),Number(item.quantity_kg))}`, href: "/feed/planning", kind: "feed" as const })),
        ...((health.data ?? []) as Array<{id:string;title:string;flock_name:string;reminder_status:string}>).map((item) => ({ id: `health-${item.id}`, title: item.title, detail: `${item.flock_name} · ${String(item.reminder_status).replaceAll("_", " ")}`, href: "/health/reminders", kind: "health" as const })),
        ...((collections.data ?? []) as Array<{sale_id:string;customer_name:string|null;outstanding_balance:number;collection_status:string}>).map((item) => ({ id: `collection-${item.sale_id}`, title: `${item.customer_name ?? "Customer"} payment ${String(item.collection_status).replaceAll("_", " ")}`, detail: money(item.outstanding_balance, currency), href: "/collections", kind: "finance" as const })),
        ...((payables.data ?? []) as Array<{id:string;supplier_name:string|null;outstanding_balance:number;supplier_due_status:string}>).map((item) => ({ id: `payable-${item.id}`, title: `${item.supplier_name ?? "Supplier"} payment ${String(item.supplier_due_status).replaceAll("_", " ")}`, detail: money(item.outstanding_balance, currency), href: "/payables", kind: "finance" as const })),
        ...lifecycleAlerts,
      ];
      setAlerts(next);
      const key = `habfarms-alerts-opened:${farmId}`;
      if (next.length && !sessionStorage.getItem(key)) { setOpen(true); sessionStorage.setItem(key, "1"); }
    };
    void load();
  }, [currency, farmId, role, timezone]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const Icon = ({ kind }: { kind: Alert["kind"] }) => kind === "feed" ? Wheat : kind === "health" ? HeartPulse : kind === "lifecycle" ? Bell : WalletCards;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label={`Open notifications${alerts.length ? ` (${alerts.length})` : ""}`} className="relative grid size-11 place-items-center rounded-xl text-stone-700 hover:bg-stone-100">
      <Bell size={20} />{alerts.length ? <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">{alerts.length > 9 ? "9+" : alerts.length}</span> : null}
    </button>
    {open ? <div className="fixed inset-0 z-[60] grid place-items-center bg-stone-950/35 p-4" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setOpen(false)}}><section role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-xl overflow-auto rounded-2xl border border-stone-200 bg-[#fffefb] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-emerald-700">Farm alerts</p><h2 id={titleId} className="mt-1 text-xl font-bold text-stone-950">{alerts.length ? "Items that need attention" : "You’re all caught up"}</h2></div><button autoFocus aria-label="Close notifications" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-lg hover:bg-stone-100"><X size={19}/></button></div>{alerts.length ? <div className="mt-5 space-y-3">{alerts.map((alert) => { const AlertIcon = Icon({ kind: alert.kind }); return <Link key={alert.id} href={alert.href} onClick={() => setOpen(false)} className="flex gap-3 rounded-xl border border-stone-200 p-4 hover:border-emerald-300 hover:bg-emerald-50"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><AlertIcon size={19}/></span><span><strong className="block text-sm text-stone-900">{alert.title}</strong><span className="mt-1 block text-sm text-stone-600">{alert.detail}</span></span></Link>; })}</div> : <div className="mt-5 rounded-xl bg-stone-50 p-5 text-sm text-stone-600"><CircleAlert className="mb-2 text-emerald-700" size={20}/>No feed, health, lifecycle or finance reminders are due in the current alert window.</div>}</section></div> : null}
  </>;
}
