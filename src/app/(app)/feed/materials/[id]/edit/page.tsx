import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { MaterialForm } from "@/components/forms/raw-material-forms";
import { Card } from "@/components/ui/card";

export default async function EditMaterial({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireRole(["admin", "manager"]); const { id } = await params; const supabase = await createClient();
  const { data: material } = await supabase.from("raw_materials").select("id,name,description,package_label,default_package_weight_kg").eq("id", id).eq("farm_id", context.farm.id).maybeSingle();
  if (!material) notFound();
  return <section className="mx-auto max-w-2xl"><Link href={`/feed/materials/${id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline"><ArrowLeft size={16}/>Back to material</Link><h1 className="mt-5 text-3xl font-bold">Edit material</h1><p className="mt-2 text-stone-600">Changing the name or description does not change recorded inventory, recipes, or costs.</p><Card className="mt-7 p-6"><MaterialForm material={material}/></Card></section>;
}
