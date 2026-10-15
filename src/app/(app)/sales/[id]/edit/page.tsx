import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { SaleForm } from "@/components/forms/sale-form";
import { Card } from "@/components/ui/card";

export default async function EditSale({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: sale }, { data: items }, { data: payments }, { data: customers }, { data: stock }] = await Promise.all([
    supabase.from("sales").select("*").eq("id", id).eq("farm_id", context.farm.id).maybeSingle(),
    supabase.from("sale_items").select("*").eq("sale_id", id),
    supabase.from("customer_payments").select("amount").eq("sale_id", id).is("voided_at", null),
    supabase.from("customers").select("id,name,default_credit_days").eq("farm_id", context.farm.id).eq("active", true),
    supabase.from("v_current_egg_inventory_by_grade").select("egg_grade_id,grade_name,total_eggs,is_unsorted,is_active").eq("farm_id", context.farm.id).eq("is_active", true),
  ]);

  if (!sale || sale.sale_type !== "egg" || sale.status !== "completed") notFound();

  const [{ data: prices }] = await Promise.all([
    supabase.rpc("get_egg_grade_prices_for_date", { target_date: sale.sale_date }),
  ]);
  const grades = (stock ?? []).map((grade) => {
    const price = prices?.find((entry: { egg_grade_id: string }) => entry.egg_grade_id === grade.egg_grade_id);
    const returned = (items ?? []).filter((item) => item.egg_grade_id === grade.egg_grade_id)
      .reduce((sum, item) => sum + Number(item.total_eggs), 0);
    const eggs = Number(grade.total_eggs) + returned;
    return {
      id: grade.egg_grade_id,
      name: grade.grade_name,
      isUnsorted: grade.is_unsorted,
      total_eggs: eggs,
      full_crates: Math.floor(eggs / context.farm.crate_size),
      loose_eggs: eggs % context.farm.crate_size,
      crate_price: price?.crate_price == null ? null : Number(price.crate_price),
      loose_egg_price: price?.loose_egg_price == null ? null : Number(price.loose_egg_price),
    };
  });
  const activePaid = (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);

  return <div>
    <h1 className="text-3xl font-bold">Edit egg sale</h1>
    <p className="mt-2 text-sm text-stone-600">Correct the sale date, customer, quantities, prices, discount, credit terms, or notes. Recorded payments are preserved.</p>
    <Card className="mt-7 p-6">
      <SaleForm
        customers={customers ?? []}
        grades={grades}
        crateSize={context.farm.crate_size}
        today={sale.sale_date}
        currency={context.farm.currency}
        record={{
          id: sale.id,
          customerId: sale.customer_id ?? "",
          saleDate: sale.sale_date,
          items: (items ?? []).map((item) => ({
            eggGradeId: item.egg_grade_id,
            unit: item.item_type,
            quantity: Number(item.quantity),
            pricePerUnit: Number(item.price_per_unit),
          })),
          discount: Number(sale.discount),
          amountPaid: activePaid,
          paymentMethod: "cash",
          notes: sale.notes ?? "",
          creditDays: sale.credit_days ?? "",
        }}
      />
    </Card>
  </div>;
}
