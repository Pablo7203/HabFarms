import { AppShell } from "@/components/layout/app-shell";
import { getAvailableFarms, getCurrentFarmAccount, requireAppContext } from "@/lib/auth/context";
import { redirect } from "next/navigation";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) { const context = await requireAppContext(); const current = await getCurrentFarmAccount(); if (current?.accessMode === "blocked") redirect("/account-status"); if (current?.account.account_status === "onboarding" && current.account.primary_owner_user_id === context.user.id) redirect("/onboarding"); return <AppShell context={context} farms={await getAvailableFarms()}>{children}</AppShell>; }
