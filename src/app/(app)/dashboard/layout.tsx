import{requireAppContext}from"@/lib/auth/context";
import{createClient}from"@/lib/supabase/server";
import{Card}from"@/components/ui/card";

export default async function DashboardLayout({children}:{children:React.ReactNode}){
  const context=await requireAppContext();
  const supabase=await createClient();
  const{data:grades}=await supabase.from("v_current_egg_inventory_by_grade").select("egg_grade_id,grade_name,total_eggs,full_crates,loose_eggs,is_unsorted,sort_order").eq("farm_id",context.farm.id).order("sort_order");
  return <>{children}<Card className="mt-7 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">Egg Inventory by Grade</h2><p className="text-sm text-stone-500">Operational quantities based on {context.farm.crate_size} eggs per crate.</p></div><p className="font-semibold">Total Egg Stock: {(grades??[]).reduce((n,x)=>n+Number(x.total_eggs),0)} eggs</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(grades??[]).map(x=><div key={x.egg_grade_id} className="rounded-xl border border-stone-200 p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{x.grade_name}</h3>{x.is_unsorted&&<span className="text-xs text-amber-800">Awaiting grading</span>}</div><p className="mt-2 text-sm"><strong>{Number(x.full_crates)}</strong> crates + <strong>{Number(x.loose_eggs)}</strong> loose</p><p className="mt-1 text-sm text-stone-500">{Number(x.total_eggs)} eggs</p></div>)}</div></Card></>;
}
