import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icon";
import { Skeleton } from "@/components/ui/skeleton";

export function EmptyState({
  icon = "empty",
  title,
  description,
  action,
  fill = true,
  className,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Take the panel's remaining height and sit dead-centre in it (see globals.css). Off for small inline states. */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      data-empty-state={fill ? "fill" : "inline"}
      className={cn(
        "flex w-full flex-1 flex-col items-center justify-center rounded-xl px-6 py-14 text-center",
        className,
      )}
    >
      <div className="bg-accent text-muted-foreground mb-3 grid size-10 place-items-center rounded-full">
        <Icon name={icon} size={18} />
      </div>
      <p className="text-subtitle font-semibold">{title}</p>
      {description && (
        <p className="text-body text-muted-foreground mt-1 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "Try again or reload the page.",
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-1 flex-col items-center justify-center rounded-xl px-6 py-14 text-center",
        className,
      )}
    >
      <div className="text-destructive mb-3 grid size-10 place-items-center rounded-full bg-destructive/10">
        <Icon name="warning" size={18} />
      </div>
      <p className="text-subtitle font-semibold">{title}</p>
      <p className="text-body text-muted-foreground mt-1 max-w-sm">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="overflow-hidden">
      <div className="flex gap-4 border-b border-accent/40 px-3 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-accent/40 px-3 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-3 shadow-surface-2 rounded-xl p-4"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-6 w-28" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
