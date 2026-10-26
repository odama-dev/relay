import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TextLink } from "@/components/text-link";
import { RefreshButton } from "@/components/refresh-button";

/** Desktop width on the 12-column grid (PRD/OVERVIEW-SPEC.md §1.6). Mobile is always one column. */
export type CardSpan = "full" | "major" | "wide" | "half" | "narrow" | "minor";

const SPAN: Record<CardSpan, string> = {
  full: "lg:col-span-12",
  major: "lg:col-span-9",
  wide: "lg:col-span-8",
  half: "lg:col-span-6",
  narrow: "lg:col-span-4",
  minor: "lg:col-span-3",
};

export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-12">{children}</div>;
}

type Props = {
  title: string;
  span?: CardSpan;
  /** Count badge next to the title (items waiting, rows found). */
  count?: number;
  /** Tints the count badge — for queues and late items. */
  countTone?: "neutral" | "warning" | "critical";
  /** The card's one main action: a link ("View all") or a control. */
  action?: { label: string; href: string } | ReactNode;
  state?: "ready" | "loading" | "error";
  /** When true, `emptyText` replaces the body. */
  isEmpty?: boolean;
  emptyText?: string;
  emptyIcon?: IconName;
  /** Phase 2 slot behind the `dashboard_phase2` flag: no data yet. */
  phase2?: boolean;
  className?: string;
  children?: ReactNode;
};

const COUNT_TONE = {
  neutral: "gray",
  warning: "amber",
  critical: "red",
} as const;

const isLinkAction = (a: Props["action"]): a is { label: string; href: string } =>
  Boolean(a && typeof a === "object" && "href" in a && "label" in a);

/**
 * One dashboard card (PRD/OVERVIEW-SPEC.md §9): a title with an optional
 * count, one main action, and its own loading, error and empty states so a
 * card that fails never takes the others down.
 */
export function DashboardCard({
  title,
  span = "narrow",
  count,
  countTone = "neutral",
  action,
  state = "ready",
  isEmpty = false,
  emptyText,
  emptyIcon = "empty",
  phase2 = false,
  className,
  children,
}: Props) {
  return (
    <section
      aria-label={title}
      aria-busy={state === "loading" || undefined}
      className={cn("bg-surface-3 shadow-surface-2 flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl p-4 [--page-gutter:1rem]", SPAN[span], className)}
    >
      <header className="flex min-h-[24px] flex-wrap items-center justify-between gap-3">
        <h2 className="text-subtitle flex min-w-0 items-center gap-2 font-semibold">
          <span className="truncate">{title}</span>
          {state === "ready" && count != null && count > 0 && (
            <Badge size="compact" color={COUNT_TONE[countTone]} className="tabular">
              {count}
            </Badge>
          )}
          {phase2 && (
            <Badge size="compact">Phase 2</Badge>
          )}
        </h2>
        {state === "ready" && action != null && (
          <div className="flex shrink-0 items-center gap-2 text-body">
            {isLinkAction(action) ? (
              <TextLink href={action.href} muted className="inline-flex items-center gap-1">
                {action.label}
                <Icon name="chevronRight" size={12} />
              </TextLink>
            ) : (
              action
            )}
          </div>
        )}
      </header>

      {state === "loading" ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : state === "error" ? (
        <div className="flex flex-col items-start gap-2 py-2 text-body">
          <p className="text-muted-foreground flex items-center gap-1.5">
            <Icon name="warning" size={14} className="text-destructive" />
            Couldn&apos;t load this card.
          </p>
          <RefreshButton label="Try again" size="compact" />
        </div>
      ) : phase2 ? (
        <p className="text-muted-foreground py-2 text-body">Arrives with Phase 2.</p>
      ) : isEmpty ? (
        <div className="flex items-center gap-2.5 py-3 text-body">
          <span className="bg-accent text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full">
            <Icon name={emptyIcon} size={14} />
          </span>
          <span className="text-muted-foreground">{emptyText}</span>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** A big number with its label — the "summary" cards (DD-4, CL-1, CL-4, FN-2). */
export function CardFigure({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "warning" | "critical" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-caption">{label}</span>
      <span
        className={cn(
          "tabular text-[18px] leading-tight font-medium",
          tone === "warning" && "text-warning",
          tone === "critical" && "text-destructive",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-muted-foreground text-caption">{hint}</span>}
    </div>
  );
}

/** A compact list inside a card; rows are links or buttons styled by the caller. */
export function CardList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("-mx-2 flex flex-col", className)}>{children}</ul>;
}

/** Group label inside a card ("Overdue 3"). */
export function CardGroupLabel({ label, count, tone }: { label: string; count?: number; tone?: "critical" | "warning" }) {
  return (
    <p
      className={cn(
        "flex items-baseline gap-2 text-caption font-medium",
        tone === "critical" && "text-destructive",
        tone === "warning" && "text-warning",
      )}
    >
      {label}
      {count != null && <span className="text-muted-foreground tabular font-normal">{count}</span>}
    </p>
  );
}

/** A side panel's sections, split by a hairline across the whole column (the panel's gutter is undone, then restored). */
export const panelSections = "-mx-[var(--page-gutter,1rem)] flex flex-col divide-y";
export const panelSection = "flex flex-col gap-1 px-[var(--page-gutter,1rem)] py-3 first:pt-0";

/** Row style shared by every card list. */
export const cardRowClass =
  "flex min-h-[34px] min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-body transition-colors duration-80 hover:bg-hover active:bg-active";
