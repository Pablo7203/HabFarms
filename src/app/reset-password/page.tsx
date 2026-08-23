import { AuthForm } from "@/components/forms/auth-form";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Reset password" };

export default async function ResetPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/forgot-password");
  return <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12"><AuthForm mode="reset" /></main>;
}
