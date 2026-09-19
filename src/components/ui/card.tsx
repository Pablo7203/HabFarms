import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[1.35rem] border border-[#e3e8de] bg-[#fffefb] shadow-[0_16px_38px_-32px_rgba(49,77,35,0.34)]",
        className,
      )}
      {...props}
    />
  );
}
