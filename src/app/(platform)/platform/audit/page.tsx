import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

type AuditRow = { id: string; action: string; entity_type: string; entity_id: string | null; created_at: string; metadata: Record<string, unknown> | null };

export default async function PlatformAuditPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_audit_logs").select("id, action, entity_type, entity_id, created_at, metadata").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as AuditRow[];
  return <div><div><p className="text-sm font-semibold text-emerald-800">Control plane</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Platform audit</h1><p className="mt-2 text-stone-600">Tenant-management actions only. Secrets and raw invitation tokens are never recorded here.</p></div><Card className="mt-7 overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-stone-50 text-stone-600"><tr><th className="px-5 py-3 font-medium">When</th><th className="px-5 py-3 font-medium">Action</th><th className="px-5 py-3 font-medium">Entity</th><th className="px-5 py-3 font-medium">Metadata</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="whitespace-nowrap px-5 py-3 text-stone-600">{new Date(row.created_at).toLocaleString()}</td><td className="px-5 py-3 font-medium">{row.action}</td><td className="px-5 py-3 text-stone-600">{row.entity_type}{row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}</td><td className="px-5 py-3 text-stone-600">{row.metadata ? JSON.stringify(row.metadata) : "—"}</td></tr>)}{!rows.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-stone-600">No platform actions have been recorded yet.</td></tr>}</tbody></table></div></Card></div>;
}
