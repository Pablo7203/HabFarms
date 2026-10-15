import Link from "next/link";
import { ArrowRight, BadgeDollarSign, Plus, Users } from "lucide-react";
import { money } from "@/lib/format";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PAGE_SIZES, Pagination, pageWindow } from "@/components/ui/pagination";

type SalesSearchParams = {
  status?: string | string[];
  collection?: string | string[];
  page?: string | string[];
  pageSize?: string | string[];
  q?: string | string[];
  customer?: string | string[];
  fromDate?: string | string[];
  toDate?: string | string[];
};

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? value
    : undefined;
}

export default async function Sales({ searchParams }: { searchParams: Promise<SalesSearchParams> }) {
  const context = await requireRole(["admin", "manager"]);
  const rawParams = await searchParams;
  const params = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [key, first(value)]),
  ) as Record<string, string | undefined>;
  const supabase = await createClient();
  const window = pageWindow(params.page, params.pageSize);
  const search = params.q?.trim().slice(0, 120) ?? "";
  const customerId = params.customer ?? "";
  const fromDate = validDate(params.fromDate);
  const toDate = validDate(params.toDate);
  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const paymentStatuses = ["unpaid", "partial", "paid"];
  const collectionStatuses = ["overdue", "due_today", "upcoming", "unscheduled", "paid"];

  const [customerResult, salesResult] = await Promise.all([
    supabase.from("customers").select("id,name").eq("farm_id", context.farm.id).order("name"),
    (async () => {
      let query = supabase
        .from("v_credit_collections")
        .select("*")
        .eq("farm_id", context.farm.id)
        .order("sale_date", { ascending: false });
      if (paymentStatuses.includes(params.status ?? "")) query = query.eq("payment_status", params.status!);
      if (collectionStatuses.includes(params.collection ?? "")) query = query.eq("collection_status", params.collection!);
      if (search) query = query.ilike("customer_name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
      if (customerId) query = query.eq("customer_id", customerId);
      if (fromDate) query = query.gte("sale_date", fromDate);
      if (toDate) query = query.lte("sale_date", toDate);
      if (dateRangeInvalid) return { data: [] };
      return query.range(window.from, window.to);
    })(),
  ]);

  const customers = customerResult.data ?? [];
  const sales = salesResult.data ?? [];
  const revenue = sales.reduce((total, sale) => total + Number(sale.sale_total ?? 0), 0);
  const outstanding = sales.reduce((total, sale) => total + Number(sale.outstanding_balance ?? 0), 0);

  return (
    <section aria-labelledby="sales-heading">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-stone-200/90 pb-6">
        <div className="max-w-xl">
          <p className="text-sm font-semibold tracking-[0.08em] text-emerald-800">Sales & customers</p>
          <h1 id="sales-heading" className="mt-2 text-3xl font-bold tracking-[-0.04em] text-stone-900 sm:text-4xl">Sales</h1>
          <p className="mt-3 leading-7 text-stone-600">Egg and bird sales share the same customer, payment, and collection records.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/sales/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold"><Plus size={18}/>Egg sale</Link>
          <Link href="/sales/bird/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm"><Plus size={18}/>Bird sale</Link>
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Summary icon={BadgeDollarSign} label="Sales value" value={money(revenue, context.farm.currency)} detail="Records on this page"/>
        <Summary icon={Users} label="Outstanding" value={money(outstanding, context.farm.currency)} detail="Still to collect"/>
        <Summary icon={ArrowRight} label="Sales records" value={sales.length.toLocaleString()} detail="Shown on this page"/>
      </section>

      <form method="get" className="mt-7 rounded-[1.35rem] border border-stone-200/90 bg-white/90 p-4 shadow-[0_18px_42px_-34px_rgba(25,65,45,0.48)] sm:p-5" aria-label="Search and filter sales">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-bold text-stone-900">Find a sale</h2>
            <p className="mt-1 text-sm text-stone-500">Search by customer or narrow results by customer, date, and status.</p>
          </div>
          <Link href="/sales" className="text-sm font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-4">Clear filters</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-stone-700 sm:col-span-2">
            Search customer name
            <input name="q" type="search" maxLength={120} defaultValue={search} placeholder="Type a customer name" className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 font-normal placeholder:text-stone-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
          </label>
          <label className="text-sm font-semibold text-stone-700">
            Customer
            <select name="customer" defaultValue={customerId} className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3">
              <option value="">All customers</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-stone-700">
            Rows per page
            <select name="pageSize" defaultValue={String(window.pageSize)} className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3">
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} rows</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-stone-700">Sale date from<input name="fromDate" type="date" defaultValue={params.fromDate ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3" /></label>
          <label className="text-sm font-semibold text-stone-700">Sale date to<input name="toDate" type="date" defaultValue={params.toDate ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3" /></label>
          <label className="text-sm font-semibold text-stone-700">Payment status<select name="status" defaultValue={params.status ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3"><option value="">All statuses</option>{paymentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label className="text-sm font-semibold text-stone-700">Collection status<select name="collection" defaultValue={params.collection ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3"><option value="">All statuses</option>{collectionStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <button className="min-h-11 self-end rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 sm:col-span-2 lg:col-span-1">Search sales</button>
        </div>
        {dateRangeInvalid && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The start date must be on or before the end date.</p>}
      </form>

      <Card className="mt-7 overflow-hidden">
        <div className="hidden grid-cols-[.9fr_1.4fr_repeat(5,1fr)] gap-3 border-b border-stone-100 bg-stone-50/80 px-6 py-3 text-xs font-bold tracking-[0.05em] text-stone-500 xl:grid">{["Sale","Customer","Type","Total","Outstanding","Due date","Collection"].map((heading) => <span key={heading}>{heading}</span>)}</div>
        {sales.map((sale) => <Link href={`/sales/${sale.sale_id}`} key={sale.sale_id} className="grid grid-cols-2 gap-3 border-b border-stone-100 p-4 transition hover:bg-emerald-50/40 sm:grid-cols-3 sm:p-5 xl:grid-cols-[.9fr_1.4fr_repeat(5,1fr)] xl:items-center xl:px-6"><strong className="min-w-0 break-words">{sale.sale_number}</strong><span className="min-w-0 break-words font-semibold text-stone-900">{sale.customer_name || "Walk-in customer"}</span><span className={`w-fit rounded-lg px-2.5 py-1 text-xs font-bold ${sale.sale_type === "bird" ? "bg-[#f2f8e5] text-[#527c22]" : "bg-stone-100 text-stone-600"}`}>{sale.sale_type === "bird" ? "Bird" : "Egg"}</span><Value label="Total" value={money(sale.sale_total, context.farm.currency)}/><Value label="Outstanding" value={money(sale.outstanding_balance, context.farm.currency)}/><Value label="Due date" value={Number(sale.outstanding_balance) > 0 ? sale.payment_due_date ?? "Unscheduled" : "—"}/><span className="capitalize"><Status value={sale.collection_status}/></span></Link>)}
        {!sales.length && <div className="p-10 text-center sm:p-14"><BadgeDollarSign className="mx-auto text-emerald-700" size={28}/><p className="mt-4 text-lg font-bold">No sales match these filters</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">Record an egg or bird sale. Payments and collections remain linked to that sale.</p><Link href="/sales/new" className="mt-6 inline-flex rounded-lg text-sm font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-4">Record a sale</Link></div>}
      </Card>
      <Pagination page={window.page} pageSize={window.pageSize} hasMore={sales.length === window.pageSize} base="/sales" params={params}/>
    </section>
  );
}

function Summary({ icon: Icon, label, value, detail }: { icon: typeof BadgeDollarSign; label: string; value: string; detail: string }) {
  return <Card className="p-5"><div className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Icon size={19}/></span><p className="text-sm font-semibold text-stone-500">{label}</p></div><p className="data-number mt-5 text-2xl font-bold tracking-[-0.035em] text-stone-900">{value}</p><p className="mt-2 text-sm text-stone-500">{detail}</p></Card>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <span className="min-w-0 break-words data-number text-sm"><span className="font-semibold text-stone-500 xl:hidden">{label}: </span>{value}</span>;
}

function Status({ value }: { value: string }) {
  const tone = value === "overdue" ? "bg-red-50 text-red-800" : value === "due_today" ? "bg-amber-50 text-amber-800" : value === "paid" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-700";
  return <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${tone}`}>{value.replaceAll("_", " ")}</span>;
}
