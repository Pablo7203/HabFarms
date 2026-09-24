"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  CircleDollarSign,
  CalendarDays,
  Factory,
  Egg,
  HandCoins,
  HeartPulse,
  LayoutDashboard,
  Menu,
  NotebookPen,
  Receipt,
  Settings,
  ShoppingCart,
  UserRound,
  Users,
  X,
  LogOut,
  Wheat,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { ChickenIcon } from "@/components/ui/chicken-icon";
import { NotificationBell } from "@/components/layout/notification-bell";
import { FarmSwitcher } from "@/components/layout/farm-switcher";
import { cn } from "@/lib/utils";
import type { AppContext, FarmChoice } from "@/types/domain";

const returnDestination = (pathname: string) => {
  const destinations = [
    ["/flocks/", "/flocks", "Flocks"],
    ["/rearing/", "/rearing", "Rearing"],
    ["/production/", "/production", "Daily production"],
    ["/health/reminders", "/health", "Health"],
    ["/health/", "/health", "Health"],
    ["/feed/", "/feed", "Feed"],
    ["/sales/", "/sales", "Sales"],
    ["/customers/", "/customers", "Customers"],
    ["/expenses/", "/expenses", "Expenses"],
    ["/cash-flow/", "/cash-flow", "Cash flow"],
    ["/reports/", "/reports", "Reports"],
    ["/settings/", "/settings", "Settings"],
    ["/eggs/", "/eggs", "Eggs"],
  ] as const;

  const match = destinations.find(([prefix]) => pathname.startsWith(prefix));
  if (match) return { href: match[1], label: match[2] };

  const currentSection = pathname.split("/").filter(Boolean)[0];
  return currentSection && pathname !== "/dashboard"
    ? { href: "/dashboard", label: "Dashboard" }
    : null;
};

export function AppShell({
  context,
  farms,
  children,
}: {
  context: AppContext;
  farms: FarmChoice[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const navigationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const admin = context.membership.role === "admin";
  const commercial = context.membership.role !== "worker";
  const back = returnDestination(pathname);

  useEffect(() => {
    const clearPending = () => {
      if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
      navigationTimeout.current = null;
      setPendingDestination(null);
    };

    // Links throughout the app use Next's client-side navigation. A global
    // capture handler gives immediate feedback even when the clicked Link is
    // deep inside a server-rendered page rather than the shared sidebar.
    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.getAttribute("target") === "_blank") return;

      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname && destination.search === window.location.search)
      ) return;

      const label = anchor.getAttribute("aria-label") || anchor.textContent?.trim().replace(/\s+/g, " ");
      const fallback = destination.pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ");
      setPendingDestination(label || fallback || "page");
      if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
      // A safety timeout prevents a stale indicator if a click is intercepted
      // or the router reports an error without changing the route.
      navigationTimeout.current = setTimeout(clearPending, 12000);
    };

    document.addEventListener("click", onDocumentClick, true);
    return () => {
      document.removeEventListener("click", onDocumentClick, true);
      if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
      navigationTimeout.current = null;
      setPendingDestination(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  const links = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/production", label: "Daily Production", icon: NotebookPen },
    { href: "/flocks", label: "Flocks", icon: ChickenIcon },
    { href: "/rearing", label: "Rearing", icon: ChickenIcon },
    { href: "/eggs", label: "Eggs", icon: Egg },
    { href: "/feed", label: "Feed", icon: Wheat },
    ...(commercial
      ? [
          { href: "/feed/planning", label: "Feed planning", icon: Wheat },
          { href: "/feed/materials", label: "Materials", icon: ShoppingCart },
          { href: "/feed/setup", label: "Feed setup", icon: Settings },
          { href: "/feed/make", label: "Make feed", icon: Factory },
          { href: "/feed/production-history", label: "Feed production", icon: Receipt },
          { href: "/feed/suppliers", label: "Suppliers", icon: Users },
        ]
      : []),
    { href: "/health", label: "Health", icon: HeartPulse },
    { href: "/health/reminders", label: "Health schedule", icon: HeartPulse },
    ...(commercial
      ? [
          { href: "/sales", label: "Sales", icon: ShoppingCart },
          { href: "/collections", label: "Collections", icon: HandCoins },
          { href: "/payables", label: "Payables", icon: Receipt },
          { href: "/customers", label: "Customers", icon: UserRound },
          { href: "/expenses", label: "Expenses", icon: Receipt },
          { href: "/cash-flow", label: "Cash flow", icon: CircleDollarSign },
          { href: "/reports/profitability", label: "Profitability", icon: BarChart3 },
        ]
      : []),
    { href: "/reports/daily-summary", label: "Daily summary", icon: NotebookPen },
    { href: "/reports/weekly-summary", label: "Weekly summary", icon: CalendarDays },
    { href: "/reports", label: "Reports", icon: BarChart3 },
    ...(admin
      ? [
          { href: "/settings", label: "Settings", icon: Settings },
          { href: "/settings/users", label: "Users", icon: Users },
        ]
      : []),
  ];
  const navigationGroups = [
    { label: "Overview", items: links.filter((link) => link.href === "/dashboard") },
    { label: "Farm operations", items: links.filter((link) => ["/production", "/flocks", "/rearing", "/eggs", "/health", "/health/reminders"].includes(link.href)) },
    { label: "Feed operations", items: links.filter((link) => ["/feed", "/feed/planning", "/feed/materials", "/feed/setup", "/feed/make", "/feed/production-history", "/feed/suppliers"].includes(link.href)) },
    { label: "Sales & customers", items: links.filter((link) => ["/sales", "/collections", "/customers"].includes(link.href)) },
    { label: "Finance", items: links.filter((link) => ["/payables", "/expenses", "/cash-flow", "/reports/profitability"].includes(link.href)) },
    { label: "Reporting", items: links.filter((link) => ["/reports/daily-summary", "/reports/weekly-summary", "/reports"].includes(link.href)) },
    { label: "Administration", items: links.filter((link) => ["/settings", "/settings/users"].includes(link.href)) },
  ].filter((group) => group.items.length);
  const nav = (
    <>
      {farms.length > 1 ? <FarmSwitcher farms={farms} activeFarmId={context.farm.id} /> : (
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="grid size-10 place-items-center rounded-xl bg-[#98cf43] font-bold text-[#294c14] shadow-sm">P</div>
          <div className="min-w-0"><p className="text-xs text-stone-500">Poultry Farm</p><p className="truncate font-semibold text-stone-900">{context.farm.name}</p></div>
        </div>
      )}
      <nav
        className="flex-1 space-y-5 overflow-y-auto p-3"
        aria-label="Main navigation"
      >
        {navigationGroups.map((group) => <div key={group.label}><p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">{group.label}</p><div className="space-y-1">{group.items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            onClick={() => setOpen(false)}
            href={href}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold",
              pathname === href || pathname.startsWith(`${href}/`)
                ? "bg-emerald-50 text-emerald-800 shadow-[inset_0_0_0_1px_rgb(16_185_129_/_0.12)]"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
            )}
          >
            <Icon size={18} strokeWidth={1.8} />
            {label}
          </Link>
        ))}</div></div>)}
      </nav>
      <form action={logoutAction} className="border-t border-stone-200 p-3">
        <button className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-stone-600 hover:bg-stone-100">
          <LogOut size={19} />
          Sign out
        </button>
      </form>
    </>
  );
  return (
    <div className="min-h-screen bg-[#f2f6ed]">
      {pendingDestination && (
        <>
          <div className="fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-emerald-100" aria-hidden="true">
            <div className="h-full w-2/5 animate-pulse rounded-r-full bg-emerald-600" />
          </div>
          <div className="fixed right-4 top-20 z-[100] flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-lg sm:right-6" role="status" aria-live="polite">
            <span className="size-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" aria-hidden="true" />
            <span className="sr-only">Loading page: </span>
            Opening {pendingDestination}…
          </div>
        </>
      )}
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-[#e4eadf] bg-white lg:flex">
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-stone-950/30"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-72 flex-col bg-white shadow-xl">
            <button
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 grid size-10 place-items-center rounded-lg hover:bg-stone-100"
            >
              <X />
            </button>
            {nav}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#e4eadf] bg-white/95 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-stone-100 lg:hidden"
            >
              <Menu />
            </button>
            {back && (
              <Link
                href={back.href}
                aria-label={`Back to ${back.label}`}
                className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                <ArrowLeft size={19} />
                <span className="hidden sm:inline">Back to {back.label}</span>
              </Link>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <NotificationBell farmId={context.farm.id} role={context.membership.role} currency={context.farm.currency} />
            <div className="text-right">
            <p className="text-sm font-semibold text-stone-900">
              {context.profile?.full_name || context.user.email}
            </p>
            <p className="text-xs capitalize text-stone-500">
              {context.membership.role}
            </p>
            </div>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
