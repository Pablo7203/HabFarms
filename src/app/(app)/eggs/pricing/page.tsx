import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { money } from "@/lib/reporting";
import { Card } from "@/components/ui/card";
import { EggPriceForm } from "@/components/forms/egg-price-form";

export default async function EggPricing() {
  const context = await requireRole(["admin", "manager"]);
  const supabase = await createClient();
  const [{ data: grades, error: gradesError }, { data: prices, error: pricesError }] =
    await Promise.all([
      supabase
        .from("egg_grades")
        .select("id,name")
        .eq("farm_id", context.farm.id)
        .eq("is_active", true)
        .eq("is_unsorted", false)
        .order("sort_order"),
      supabase
        .from("egg_grade_prices")
        .select("*,egg_grades(name)")
        .eq("farm_id", context.farm.id)
        .order("effective_from", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

  if (gradesError || pricesError) throw new Error("Could not load egg pricing");

  const creatorIds = [...new Set((prices ?? []).map((price) => price.created_by))];
  const { data: creators, error: creatorsError } = creatorIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", creatorIds)
    : { data: [], error: null };

  if (creatorsError) throw new Error("Could not load egg pricing creators");

  const creatorNames = new Map(
    (creators ?? []).map((creator) => [creator.id, creator.full_name]),
  );

  return (
    <div>
      <h1 className="text-3xl font-bold">Egg grade pricing</h1>
      <p className="mt-2 text-stone-600">
        Prices are effective-dated suggestions. Sale lines keep their actual historical price.
      </p>
      <Card className="mt-7 p-5 sm:p-7">
        <EggPriceForm grades={grades ?? []} today={farmToday(context.farm.timezone)} />
      </Card>
      <Card className="mt-7 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50">
            <tr>
              {["Grade", "Effective from", "Crate price", "Loose price", "Entered by", "Entered at"].map((heading) => (
                <th className="p-4" key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices?.map((price) => (
              <tr className="border-t" key={price.id}>
                <td className="p-4 font-medium">{price.egg_grades?.name}</td>
                <td className="p-4">{price.effective_from}</td>
                <td className="p-4">{price.crate_price == null ? "—" : money(price.crate_price, context.farm.currency)}</td>
                <td className="p-4">{price.loose_egg_price == null ? "—" : money(price.loose_egg_price, context.farm.currency)}</td>
                <td className="p-4">{creatorNames.get(price.created_by) ?? "—"}</td>
                <td className="p-4">{new Date(price.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!prices?.length && <p className="p-8 text-center text-stone-500">No grade prices have been entered.</p>}
      </Card>
    </div>
  );
}
