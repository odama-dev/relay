import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SummaryItem = {
  label: string;
  /** One line per value (e.g. one per currency). Empty renders "—". */
  values: ReactNode[];
  tone?: "default" | "destructive";
  /** Small line under the value, e.g. a TrendDelta. */
  delta?: ReactNode;
  /** Beside the label, right-aligned (e.g. a target badge). `even` only. */
  badge?: ReactNode;
};

/**
 * A page's key figures as one edge-to-edge strip, closed by a hairline.
 * "list" (list pages): label over value, each figure split by a full-height
 * hairline. "even" (dashboards): figures share the width, split by a short
 * divider, the first and last on the page gutter.
 */
export function SummaryStrip({ items, variant = "list", className }: { items: SummaryItem[]; variant?: "list" | "even"; className?: string }) {
  if (variant === "even") {
    return (
      <div className={cn("bleed flex flex-wrap border-b", className)}>
        {items.map((item, i) => (
          <div
            key={item.label}
            className={cn(
              "relative flex min-w-44 flex-1 flex-col gap-1.5 px-6 py-4 first:pl-0 last:pr-0",
              i > 0 && "before:bg-border before:absolute before:top-1/2 before:left-0 before:h-10 before:w-px before:-translate-y-1/2",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-caption">{item.label}</span>
              {item.badge}
            </span>
            {(item.values.length === 0 ? ["—"] : item.values).map((v, j) => (
              <span key={j} className={cn("tabular truncate text-[20px] leading-[25px] font-medium", item.tone === "destructive" && "text-destructive")}>
                {v}
              </span>
            ))}
            {item.delta}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={cn("bleed flex flex-wrap border-b", className)}>
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn("flex min-w-40 flex-col gap-0.5 py-3 pr-6", i > 0 && "border-l pl-6")}
        >
          <span className="text-muted-foreground text-caption">{item.label}</span>
          {(item.values.length === 0 ? ["—"] : item.values).map((v, j) => (
            <span
              key={j}
              className={cn("tabular text-title font-semibold", item.tone === "destructive" && "text-destructive")}
            >
              {v}
            </span>
          ))}
          {item.delta}
        </div>
      ))}
    </div>
  );
}
