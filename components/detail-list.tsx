import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Side-panel key/value list on detail pages. Empty values render as a muted
 * dash. `grid` lays the items out in columns (3, or 2 on small screens) for a
 * wide panel; labels in `wide` (e.g. free-text notes) take a full row.
 */
export function DetailList({ items, className, grid = false, wide = [] }: { items: [string, ReactNode][]; className?: string; grid?: boolean; wide?: string[] }) {
  return (
    <dl
      className={cn(
        "bg-surface-3 shadow-surface-2 self-start rounded-xl p-4 text-body",
        grid ? "grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3" : "flex flex-col gap-3",
        className,
      )}
    >
      {items.map(([label, value]) => (
        <div key={label} className={cn("flex min-w-0 flex-col gap-0.5", grid && wide.includes(label) && "col-span-full")}>
          <dt className="text-muted-foreground text-caption">{label}</dt>
          <dd className="break-words whitespace-pre-line">{value || value === 0 ? value : <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
