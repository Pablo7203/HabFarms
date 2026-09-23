import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { farmToday } from "@/lib/farm-date";
import { Card } from "@/components/ui/card";
import { RearingBatchForm } from "@/components/forms/rearing-forms";

export const metadata = { title: "Create rearing batch" };
export default async function NewRearingBatch(){const context=await requireRole(["admin","manager"]),supabase=await createClient(),[{data:suppliers}]=await Promise.all([supabase.from("suppliers").select("id,name").eq("farm_id",context.farm.id).eq("active",true).order("name")]);return <div className="mx-auto max-w-3xl"><Link href="/rearing" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-stone-600 hover:text-emerald-800"><ArrowLeft size={18}/>Back to rearing</Link><h1 className="mt-3 text-3xl font-bold">Create DOC batch</h1><p className="mt-2 text-stone-600">Record the chick cohort and arrival details. The system will create its opening population movement once.</p><Card className="mt-6 p-5 sm:p-7"><RearingBatchForm today={farmToday(context.farm.timezone)} suppliers={suppliers??[]}/></Card></div>}
