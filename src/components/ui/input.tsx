import * as React from "react";
import { cn } from "@/lib/utils";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn("min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-950 outline-none placeholder:text-stone-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100", className)} {...props} />);
Input.displayName = "Input";
