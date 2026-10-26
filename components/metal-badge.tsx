import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small brushed-metal pill (e.g. "Coming soon"); styles in globals.css (.metal-badge). */
export function MetalBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "metal-badge inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[length:var(--fs-micro,11px)] leading-none font-medium tracking-[0.01em] whitespace-nowrap normal-case",
        className,
      )}
    >
      <span className="relative z-10">{children}</span>
    </span>
  );
}
