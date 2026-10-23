import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { reportRange, money } from "@/lib/reporting";
import { DateFilter, Kpis } from "@/components/reports/report-ui";
import { ReportTable } from "@/components/reports/report-table";

export default async function SalesReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requireRole(["admin", "manager"]);
  const query = await searchParams;
  const range = reportRange(context.farm.timezone, query);
  const supabase = await createClient();
  const customerId = query.customer || null;
  const gradeId = query.grade || null;

  const [
    { data: summary },
    { data: collections },
    { data: customers },
    { data: gradeRows },
    { data: grades },
    { data: matchingSales },
  ] = await Promise.all([
    supabase.rpc("get_sales_report_summary", {
      start_date: range.from,
      end_date: range.to,
      target_customer: customerId,
    }),
    supabase
      .from("v_credit_collections")
      .select("*")
      .eq("farm_id", context.farm.id)
      .gte("sale_date", range.from)
      .lte("sale_date", range.to),
    supabase.from("customers").select("id,name").eq("farm_id", context.farm.id),
    supabase
      .from("v_sales_by_grade")
      .select("*")
      .eq("farm_id", context.farm.id)
      .gte("sale_date", range.from)
      .lte("sale_date", range.to),
    supabase
      .from("egg_grades")
      .select("id,name,is_unsorted,sort_order")
      .eq("farm_id", context.farm.id)
      .order("sort_order"),
    customerId
      ? supabase.from("sales").select("id").eq("farm_id", context.farm.id).eq("customer_id", customerId).eq("status", "completed").eq("sale_type", "egg").gte("sale_date", range.from).lte("sale_date", range.to)
      : Promise.resolve({ data: null }),
  ]);

  const totals = summary?.[0] ?? {};
  const matchingSaleIds = customerId ? new Set((matchingSales ?? []).map((sale) => sale.id)) : null;
  const filtered = (gradeRows ?? []).filter(
    (row) => (!gradeId || row.egg_grade_id === gradeId) && (!matchingSaleIds || matchingSaleIds.has(row.sale_id)),
  );
  const eggsSold = filtered.reduce(
    (total, row) => total + Number(row.total_eggs),
    0,
  );
  const crateSize = Math.max(1, Number(context.farm.crate_size) || 30);
  const fullCrates = Math.floor(eggsSold / crateSize);
  const looseEggs = eggsSold % crateSize;
  const number = new Intl.NumberFormat("en");
  const crateDisplay = `${number.format(fullCrates)} ${fullCrates === 1 ? "crate" : "crates"}${looseEggs ? ` + ${number.format(looseEggs)} ${looseEggs === 1 ? "egg" : "eggs"}` : ""}`;

  const byGrade = Object.values(
    filtered.reduce<
      Record<string, { name: string; eggs: number; revenue: number; crates: number; loose: number }>
    >((accumulator, row) => {
      const id = row.egg_grade_id;
      accumulator[id] ??= {
        name: row.grade_name,
        eggs: 0,
        revenue: 0,
        crates: 0,
        loose: 0,
      };
      accumulator[id].eggs += Number(row.total_eggs);
      accumulator[id].revenue += Number(row.line_total);
      if (row.item_type === "crate") accumulator[id].crates += Number(row.quantity);
      else accumulator[id].loose += Number(row.quantity);
      return accumulator;
    }, {}),
  );

  return (
    <div>
      <h1 className="text-3xl font-bold">Sales by egg grade</h1>
      <p className="mt-2 text-stone-600">
        Grade revenue uses each sale item&apos;s historical price snapshot.
      </p>
      <DateFilter from={range.from} to={range.to} exportType="sales">
        <label>
          Customer
          <select
            name="customer"
            defaultValue={query.customer ?? ""}
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="">All customers</option>
            {customers?.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Egg grade
          <select
            name="grade"
            defaultValue={query.grade ?? ""}
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          >
            <option value="">All grades</option>
            {grades?.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.is_unsorted ? `${grade.name} (not yet graded)` : grade.name}
              </option>
            ))}
          </select>
        </label>
      </DateFilter>
      <Kpis
        items={[
          ["Sales revenue", money(totals.revenue, context.farm.currency)],
          [
            "Eggs sold",
            crateDisplay,
            `${number.format(eggsSold)} eggs total · ${number.format(crateSize)} eggs per crate`,
          ],
          ["Amount paid", money(totals.amount_paid, context.farm.currency)],
          ["Outstanding", money(totals.outstanding_receivables, context.farm.currency)],
        ]}
      />
      <ReportTable
        headers={["Grade", "Eggs sold", "Crates sold", "Loose sold", "Revenue", "Revenue per egg"]}
        rows={byGrade.map((row) => [
          row.name,
          row.eggs,
          row.crates,
          row.loose,
          money(row.revenue, context.farm.currency),
          money(row.eggs ? row.revenue / row.eggs : 0, context.farm.currency),
        ])}
        empty="No egg sales in this period."
      />
      <h2 className="mt-8 text-xl font-semibold">Receivables remain sale-level</h2>
      <ReportTable
        headers={["Sale", "Customer", "Total", "Paid", "Outstanding", "Due", "Status"]}
        rows={(collections ?? [])
          .filter((row) => !customerId || row.customer_id === customerId)
          .map((row) => [
            row.sale_number,
            row.customer_name ?? "Walk-in",
            money(row.sale_total, context.farm.currency),
            money(row.total_paid, context.farm.currency),
            money(row.outstanding_balance, context.farm.currency),
            row.payment_due_date ?? "—",
            row.collection_status.replace("_", " "),
          ])}
        empty="No receivables in this period."
      />
    </div>
  );
}

