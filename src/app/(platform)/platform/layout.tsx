import { requirePlatformAdmin } from "@/lib/auth/context";
import Link from "next/link";
import { Activity, Building2, ClipboardList, Clock3, CreditCard, LayoutDashboard, ReceiptText, RefreshCw, ScrollText, Settings } from "lucide-react";

const navigation = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard },
  { href: "/platform/farms", label: "Farms", icon: Building2 },
  { href: "/platform/trials", label: "Trials", icon: Clock3 },
  { href: "/platform/invitations", label: "Invitations", icon: ClipboardList },
  { href: "/platform/audit", label: "Audit", icon: ScrollText },
  { href: "/platform/plans", label: "Plans", icon: Settings },
  { href: "/platform/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/platform/collections", label: "Collections", icon: ReceiptText },
  { href: "/platform/renewals", label: "Renewals", icon: RefreshCw },
  { href: "/platform/payments", label: "Payments", icon: ReceiptText },
  { href: "/platform/operations", label: "Operations", icon: Activity },
  { href: "/platform/settings", label: "Settings", icon: Settings },
];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <div className="min-h-screen min-w-0 bg-[#edf2e7] text-stone-950"><header className="border-b border-stone-200 bg-white"><div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6"><Link href="/platform" className="flex items-center gap-3 font-semibold"><span className="grid size-9 place-items-center rounded-xl bg-lime-500 text-stone-950">P</span><span>HabFarms <span className="text-stone-500">Platform</span></span></Link><Link href="/dashboard" className="text-sm font-medium text-stone-600 hover:text-emerald-800">Farm workspace</Link></div></header><div className="mx-auto grid w-full min-w-0 max-w-[1500px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]"><nav className="min-w-0 border-b border-stone-200 bg-white px-3 py-4 lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r"><p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Platform management</p><div className="flex min-w-0 max-w-full gap-1 overflow-x-auto lg:block">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-sm font-medium text-stone-700 hover:bg-lime-50 hover:text-emerald-900"><Icon className="size-4" aria-hidden="true" />{label}</Link>)}</div></nav><main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main></div></div>;
}
