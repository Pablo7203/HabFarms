import { Card } from "@/components/ui/card";
import { PlatformSettingsForm, type PlatformSettingsValues } from "@/components/forms/platform-operations";
import { createClient } from "@/lib/supabase/server";

export default async function PlatformSettingsPage() {
  const { data } = await (await createClient()).rpc("platform_get_settings");
  const settings = (Array.isArray(data) ? data[0] : data) as PlatformSettingsValues | null;
  if (!settings) return <p className="rounded-xl border bg-white p-5 text-sm text-stone-600">Platform settings are unavailable.</p>;
  return <div className="mx-auto max-w-4xl"><p className="text-sm font-semibold text-emerald-800">Control plane</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Platform settings</h1><p className="mt-2 text-stone-600">Safe commercial and communication defaults. Secrets and provider credentials are configured outside the application.</p><Card className="mt-7 p-5 sm:p-7"><PlatformSettingsForm settings={settings} /></Card></div>;
}
