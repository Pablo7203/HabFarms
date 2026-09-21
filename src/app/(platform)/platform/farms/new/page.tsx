import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PlatformFarmForm } from "@/components/forms/platform-farms";

export default async function NewPlatformFarm() { const supabase = await createClient(); const { data } = await supabase.from("subscription_plans").select("id,name,default_trial_days").eq("is_active", true).order("name"); const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date()); return <div className="mx-auto max-w-3xl"><h1 className="text-3xl font-bold">Create customer farm</h1><p className="mt-2 text-stone-600">This creates the tenant, commercial foundation, and secure owner invitation atomically. Email delivery runs afterward and can be retried.</p><Card className="mt-7 p-5 sm:p-7"><PlatformFarmForm plans={data ?? []} today={today} /></Card></div>; }
