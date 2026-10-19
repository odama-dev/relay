import { Suspense, type ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import type { Kpi } from "@/lib/clevel/queries";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { DashboardCard, DashboardGrid } from "@/components/dashboard-card";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

export type ValueFormat = "idr" | "percent" | "hours" | "count";

export function fmt(v: number | null | undefined, f: ValueFormat): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (f === "idr") return formatMoney(v, "IDR");
  if (f === "percent") return formatPercent(v, 1);
  if (f === "hours") return `${formatNumber(Math.round(v * 10) / 10)}h`;
  return formatNumber(v);
}

/** Compact IDR for tiles ("IDR 195M"); the full value is in the title. */
export function idrCompact(v: number | null | undefined): string {
  return v == null ? "—" : formatMoney(v, "IDR", { compact: true });
}

const STATUS = { good: { value: "on_track", label: "Good" }, watch: { value: "warning", label: "Watch" }, bad: { value: "over_budget", label: "Behind" } } as const;

/** Good / Watch / Behind against a target (§2.4) — the badge always carries the word, not just the color. */
export function TargetBadge({ status }: { status: "good" | "watch" | "bad" | null }) {
  if (!status) return null;
  return <StatusBadge value={STATUS[status].value} label={STATUS[status].label} />;
}

/** Change vs the previous period: "+12.5% vs prev." — tinted only when `goodWhenUp` says which way is good. */
export function DeltaText({ change, pct, format, goodWhenUp = true, className }: { change: number; pct: number | null; format: ValueFormat; goodWhenUp?: boolean | null; className?: string }) {
  if (change === 0) return <span className={cn("text-muted-foreground text-caption", className)}>No change vs previous period</span>;
  const up = change > 0;
  const good = goodWhenUp === null ? null : up === goodWhenUp;
  const amount = format === "percent" ? `${up ? "+" : ""}${change.toFixed(1)} pts` : `${up ? "+" : "−"}${fmt(Math.abs(change), format)}`;
  return (
    <span className={cn("text-muted-foreground text-caption", className)}>
      <span className={cn("tabular font-medium", good === true && "text-success", good === false && "text-destructive")}>
        {amount}
        {pct !== null && format !== "percent" && ` (${up ? "+" : ""}${pct.toFixed(1)}%)`}
      </span>{" "}
      vs previous period
    </span>
  );
}

/** A headline number (§2.2): value, change vs the previous period, and progress vs target when there is one. */
export function KpiTile({ label, kpi, format, hint, flag }: { label: string; kpi: Kpi; format: ValueFormat; hint?: ReactNode; flag?: ReactNode }) {
  return (
    <div className="bg-surface-3 shadow-surface-2 flex min-w-0 flex-col gap-1.5 rounded-xl p-4">
      <span className="text-muted-foreground flex items-center justify-between gap-2 text-caption">
        {label}
        <TargetBadge status={kpi.status} />
      </span>
      <span className="tabular truncate text-[20px] leading-tight font-medium" title={fmt(kpi.value, format)}>
        {format === "idr" ? idrCompact(kpi.value) : fmt(kpi.value, format)}
        {flag}
      </span>
      <DeltaText change={kpi.change} pct={kpi.changePct} format={format} />
      {kpi.target !== null && (
        <span className="text-muted-foreground text-caption">
          <span className="tabular">{formatPercent(kpi.targetPct, 0)}</span> of target to date ({format === "idr" ? idrCompact(kpi.target) : fmt(kpi.target, format)})
        </span>
      )}
      {hint && <span className="text-muted-foreground text-caption">{hint}</span>}
    </div>
  );
}

/** A plain figure tile for numbers without a target. */
export function FigureTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warning" | "critical" }) {
  return (
    <div className="bg-surface-3 shadow-surface-2 flex min-w-0 flex-col gap-1.5 rounded-xl p-4">
      <span className="text-muted-foreground text-caption">{label}</span>
      <span className={cn("tabular truncate text-[20px] leading-tight font-medium", tone === "warning" && "text-warning", tone === "critical" && "text-destructive")}>{value}</span>
      {hint && <span className="text-muted-foreground text-caption">{hint}</span>}
    </div>
  );
}

/** Marks a number computed from incomplete cost data (§4.3). */
export function IncompleteFlag({ title = "Cost data is incomplete" }: { title?: string }) {
  return (
    <span title={title} className="text-warning ml-1 align-super text-caption">
      *<span className="sr-only">{title}</span>
    </span>
  );
}

export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-0.5 pt-2">
      <h2 className="text-title leading-normal font-medium">{title}</h2>
      <p className="text-muted-foreground text-body">{description}</p>
    </div>
  );
}

/**
 * A dashboard section that loads once and renders several cards; while
 * loading it shows skeleton cards, and a failure becomes one error card.
 */
export async function SectionBody<T>({ title, load, children }: { title: string; load: () => Promise<T>; children: (data: T) => ReactNode }) {
  let data: T;
  try {
    data = await load();
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[clevel] ${title} failed`, err);
    return (
      <DashboardGrid>
        <DashboardCard title={title} span="full" state="error" />
      </DashboardGrid>
    );
  }
  return <>{children(data)}</>;
}

export function Section<T>({ title, description, load, skeleton, children }: { title: string; description: string; load: () => Promise<T>; skeleton: ("full" | "wide" | "narrow")[]; children: (data: T) => ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <SectionHeading title={title} description={description} />
      <Suspense
        fallback={
          <DashboardGrid>
            {skeleton.map((span, i) => (
              <DashboardCard key={i} title="Loading…" span={span} state="loading" />
            ))}
          </DashboardGrid>
        }
      >
        <SectionBody title={title} load={load}>
          {children}
        </SectionBody>
      </Suspense>
    </section>
  );
}

/** Horizontal share bar (hours composition) — segments with 2px gaps, values in the legend and titles. */
export function ShareBar({ parts, total }: { parts: { label: string; value: number; tone: 1 | 2 | 3 | 4 }[]; total: number }) {
  const TONE = { 1: "bg-[var(--chart-1)]", 2: "bg-[var(--chart-2)]", 3: "bg-[var(--chart-3)]", 4: "bg-[var(--chart-4)]" };
  if (total <= 0) return <div className="bg-accent h-3 rounded-sm" aria-hidden />;
  return (
    <div className="flex h-3 gap-[2px] overflow-hidden rounded-sm" role="img" aria-label={parts.map((p) => `${p.label} ${fmt(p.value, "hours")}`).join(", ")}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} title={`${p.label}: ${fmt(p.value, "hours")} (${Math.round((p.value / total) * 100)}%)`} className={TONE[p.tone]} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
    </div>
  );
}
