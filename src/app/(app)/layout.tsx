import { AppShell } from "@/components/layout/app-shell";
import { requireAppContext } from "@/lib/auth/context";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) { const context = await requireAppContext(); return <AppShell context={context}>{children}</AppShell>; }
