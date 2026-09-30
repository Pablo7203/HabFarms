import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--farm-card-radius)] border border-[var(--farm-border)] bg-[var(--farm-surface)] shadow-[0_16px_38px_-32px_rgba(49,77,35,0.34)]",
        className,
      )}
      {...props}
    />
  );
}
