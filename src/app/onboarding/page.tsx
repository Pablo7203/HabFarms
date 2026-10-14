import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { OnboardingForm } from "@/components/forms/onboarding-form";
import { PlatformOnboarding } from "@/components/forms/platform-onboarding";
import { getCurrentAppContext, getCurrentFarmAccount, requireAuth } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Create your farm", robots: { index: false, follow: false } };

export default async function OnboardingPage() {
  await requireAuth();
  const current = await getCurrentFarmAccount();
  if (current) {
    if (current.account.account_status === "onboarding" && current.account.primary_owner_user_id === current.context.user.id) {
      const supabase = await createClient();
      const [{ data: settings, error: settingsError }, { data: progress, error: progressError }] = await Promise.all([
        supabase.from("farm_settings").select("default_egg_price_per_crate, default_loose_egg_price, feed_alert_warning_days, feed_alert_critical_days, average_feed_days_window").eq("farm_id", current.context.farm.id).single(),
        supabase.rpc("get_my_onboarding_progress", { target_farm: current.context.farm.id }),
      ]);
      const onboarding = progress?.[0];
      if (settingsError || progressError || !settings || !onboarding) {
        console.error("[onboarding] Setup data unavailable", {
          farmId: current.context.farm.id,
          settingsCode: settingsError?.code ?? (!settings ? "missing" : null),
          progressCode: progressError?.code ?? (!onboarding ? "missing" : null),
        });
        // Sending an unfinished owner to /dashboard redirects straight back here.
        return (
          <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12">
            <Card className="w-full max-w-lg p-6 sm:p-9">
              <h1 className="text-2xl font-bold">We couldn’t load your farm setup</h1>
              <p className="mt-3 text-stone-600">Your account is signed in, but your setup details are unavailable. Try again. If this continues, contact HabFarms support.</p>
              <a href="/onboarding" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Try again</a>
            </Card>
          </main>
        );
      }
      return <PlatformOnboarding farm={{ ...current.context.farm, opening_cash_balance: Number(current.context.farm.opening_cash_balance) }} settings={settings} progress={{ settings: !!onboarding.farm_settings_completed_at, flock: !!onboarding.first_flock_completed_at || !!onboarding.first_flock_skipped_at, opening: !!onboarding.opening_stock_completed_at || !!onboarding.opening_stock_skipped_at }} />;
    }
    redirect("/dashboard");
  }
  if (await getCurrentAppContext()) redirect("/dashboard");
  const supabase = await createClient();
  const { data: pending } = await supabase.rpc("get_pending_farm_invitations");
  if (pending?.length) redirect("/accept-invitation");
  return <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12"><Card className="w-full max-w-lg p-6 sm:p-9"><div className="grid size-12 place-items-center rounded-xl bg-emerald-700 text-xl font-bold text-white">P</div><h1 className="mt-7 text-3xl font-bold tracking-tight">Set up your farm</h1><p className="mt-2 text-stone-600">Give your workspace a name. Practical defaults are ready, and you can adjust them later.</p><OnboardingForm /></Card></main>;
}
