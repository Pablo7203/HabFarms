import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { OnboardingForm } from "@/components/forms/onboarding-form";
import { getCurrentAppContext, requireAuth } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
export const metadata = { title: "Create your farm" };
export default async function OnboardingPage() { await requireAuth(); if (await getCurrentAppContext()) redirect("/dashboard"); const supabase=await createClient(),{data:pending}=await supabase.rpc("get_pending_farm_invitations");if(pending?.length)redirect("/accept-invitation");return <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12"><Card className="w-full max-w-lg p-6 sm:p-9"><div className="grid size-12 place-items-center rounded-xl bg-emerald-700 text-xl font-bold text-white">P</div><h1 className="mt-7 text-3xl font-bold tracking-tight">Set up your farm</h1><p className="mt-2 text-stone-600">Give your workspace a name. Practical defaults are ready, and you can adjust them later.</p><OnboardingForm /></Card></main>; }
