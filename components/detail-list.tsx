import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Side-panel key/value list on detail pages. Empty values render as a muted dash. */
export function DetailList({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("bg-surface-3 shadow-surface-2 flex flex-col gap-3 self-start rounded-xl p-4 text-body", className)}>
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-caption">{label}</dt>
          <dd className="break-words whitespace-pre-line">{value || value === 0 ? value : <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
