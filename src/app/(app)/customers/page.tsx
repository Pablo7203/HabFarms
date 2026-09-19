import Link from "next/link";
import { ArrowUpRight, ContactRound, MapPin, Phone, Plus, UsersRound } from "lucide-react";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Pagination, pageWindow } from "@/components/ui/pagination";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; active?: string; type?: string; page?: string }> }) {
  const context = await requireRole(["admin", "manager"]);
  const params = await searchParams;
  const supabase = await createClient();
  const window = pageWindow(params.page);
  let query = supabase.from("customers").select("id,name,phone,location,customer_type,active").eq("farm_id", context.farm.id).order("name");
  if (params.q) query = query.ilike("name", `%${params.q}%`);
  if (params.active !== "all") query = query.eq("active", params.active !== "inactive");
  if (params.type) query = query.eq("customer_type", params.type);
  const { data: customers } = await query.range(window.from, window.to);
  const activeCount = (customers ?? []).filter((customer) => customer.active).length;

  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Sales workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Customers</h1>
        <p className="mt-2 max-w-xl text-stone-600">Keep the people and businesses you sell to organised, ready for sales and collection follow-up.</p>
      </div>
      <Link href="/customers/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900"><Plus size={18}/>New customer</Link>
    </div>

    <section className="grid gap-4 sm:grid-cols-3">
      <Card className="p-5"><UsersRound size={21} className="text-emerald-700"/><p className="mt-5 text-sm text-stone-500">Customers in this view</p><p className="mt-1 text-3xl font-bold data-number">{(customers ?? []).length}</p></Card>
      <Card className="p-5"><ContactRound size={21} className="text-sky-700"/><p className="mt-5 text-sm text-stone-500">Active customers</p><p className="mt-1 text-3xl font-bold data-number">{activeCount}</p></Card>
      <Card className="p-5"><ArrowUpRight size={21} className="text-amber-700"/><p className="mt-5 text-sm text-stone-500">Next step</p><p className="mt-1 text-base font-semibold">Open a customer to view sales and balances</p></Card>
    </section>

    <form className="grid gap-3 rounded-[1.35rem] border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-[1.5fr_0.75fr_auto]">
      <label className="sr-only" htmlFor="customer-search">Search customers</label>
      <input id="customer-search" name="q" placeholder="Search customer name" defaultValue={params.q} className="min-h-11 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"/>
      <label className="sr-only" htmlFor="customer-status">Customer status</label>
      <select id="customer-status" name="active" defaultValue={params.active ?? "active"} className="min-h-11 rounded-xl border border-stone-200 bg-white px-3 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All customers</option></select>
      <button className="min-h-11 rounded-xl border border-stone-300 px-5 text-sm font-semibold transition hover:bg-stone-50">Apply filters</button>
    </form>

    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4"><div><h2 className="font-semibold">Customer directory</h2><p className="mt-1 text-sm text-stone-500">Select a customer to review their full relationship.</p></div></div>
      <div className="divide-y divide-stone-100">
        {customers?.map((customer) => <Link href={`/customers/${customer.id}`} key={customer.id} className="group grid gap-3 px-5 py-4 transition hover:bg-emerald-50/45 md:grid-cols-[1.5fr_1fr_1fr_auto] md:items-center">
          <div><p className="font-semibold text-stone-900">{customer.name}</p><p className="mt-1 text-sm capitalize text-stone-500">{customer.customer_type.replaceAll("_", " ")}</p></div>
          <p className="inline-flex items-center gap-2 text-sm text-stone-600"><Phone size={15} className="text-stone-400"/>{customer.phone || "No phone number"}</p>
          <p className="inline-flex items-center gap-2 text-sm text-stone-600"><MapPin size={15} className="text-stone-400"/>{customer.location || "No location"}</p>
          <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ${customer.active ? "bg-emerald-100 text-emerald-900" : "bg-stone-100 text-stone-600"}`}>{customer.active ? "Active" : "Inactive"}</span>
        </Link>)}
        {!customers?.length && <div className="px-6 py-12 text-center"><UsersRound className="mx-auto text-stone-300" size={28}/><p className="mt-3 font-semibold">No customers found</p><p className="mt-1 text-sm text-stone-500">Try adjusting the filters or add your first customer.</p></div>}
      </div>
    </Card>
    <Pagination page={window.page} hasMore={(customers?.length ?? 0) === 50} base="/customers" params={params}/>
  </div>;
}
