import { WORK_PERIOD_LABELS, WORK_PERIOD_PREVIOUS, type WorkPeriod } from "@/lib/dashboard/pure";
import { formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared parts of the period-based dashboards (Designer & Developer, PM):
 * the change line under a KPI and the strip's loading state.
 */

/** "+3 vs last week" — green when up unless `goodWhenUp` is false; no change reads "Same as …". */
export function Change({ value, previous, period, hours = false, goodWhenUp = true }: { value: number; previous: number; period: WorkPeriod; hours?: boolean; goodWhenUp?: boolean }) {
  const against = WORK_PERIOD_PREVIOUS[period.kind];
  const change = value - previous;
  if (change === 0) return <span className="text-muted-foreground text-caption">Same as {against}</span>;
  const up = change > 0;
  return (
    <span className="text-muted-foreground text-caption">
      <span className={cn("tabular font-medium", up === goodWhenUp ? "text-success" : "text-destructive")}>
        {up ? "+" : "−"}
        {hours ? formatHours(Math.abs(change)) : Math.abs(change)}
      </span>{" "}
      vs {against}
    </span>
  );
}

/** "This week, per day" — what one chart bar covers. */
export function bucketCaption(period: WorkPeriod) {
  return `${WORK_PERIOD_LABELS[period.kind]}, per ${period.kind === "week" ? "day" : period.kind === "month" ? "week" : "month"}`;
}

export function StripSkeleton({ items = 4 }: { items?: number }) {
  return (
    <div className="bleed flex border-b">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex flex-1 flex-col gap-2 px-6 py-4 first:pl-0">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
