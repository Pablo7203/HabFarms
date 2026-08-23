import * as React from "react";
import { cn } from "@/lib/utils";
export function Button({ className, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={cn("inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-60", variant === "primary" && "bg-emerald-700 text-white hover:bg-emerald-800", variant === "secondary" && "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50", variant === "ghost" && "text-stone-700 hover:bg-stone-100", className)} {...props} />;
}
