import type { HealthStatus } from "@/lib/health/pure";
import { HEALTH_LABELS } from "@/lib/health/pure";
import { formatHoursValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProgressTone } from "@/components/progress-bar";
import Image from "next/image";

export const HEALTH_TONE: Record<HealthStatus, ProgressTone> = {
  on_track: "success",
  warning: "warning",
  over_budget: "destructive",
  no_budget: "muted",
};

// Signal states from the Figma file (Rafie's Shot 2026, nodes 7939:9951…9973),
// exported as-is to public/icons/signal.
const SIGNAL = [
  { min: 0, src: "/icons/signal/signal-0.svg" },
  { min: 20, src: "/icons/signal/signal-20.svg" },
  { min: 40, src: "/icons/signal/signal-40.svg" },
  { min: 95, src: "/icons/signal/signal-95.svg" },
] as const;

function signalSrc(pct: number) {
  const r = Math.round(pct);
  if (r > 100) return "/icons/signal/signal-over.svg";
  return SIGNAL.findLast((s) => r >= s.min)?.src ?? SIGNAL[0].src;
}

/** Signal icon for a budget percentage: grey → yellow → blue → green, red once over budget. */
export function SignalMeter({ pct, size = 20, className }: { pct: number; size?: number; className?: string }) {
  return <Image src={signalSrc(pct)} alt="" width={size} height={size} unoptimized aria-hidden className={cn("shrink-0", className)} />;
}

/**
 * Compact health read-out for tables (M1.6 / M4.5): a signal meter and the
 * percentage, or the hours used when the project has no budget.
 */
export function HealthIndicator({
  health,
  className,
}: {
  health: { status: HealthStatus; pct: number | null; usedHours: number; budgetHours: number | null };
  className?: string;
}) {
  if (health.pct === null) {
    return (
      <span className={cn("flex items-center gap-1", className)}>
        <SignalMeter pct={0} />
        <span className="tabular">{formatHoursValue(health.usedHours)} logged</span>
      </span>
    );
  }
  return (
    <span className={cn("flex items-center gap-1", className)} title={`${HEALTH_LABELS[health.status]} · ${formatHoursValue(health.usedHours)} of ${formatHoursValue(health.budgetHours ?? 0)}`}>
      <SignalMeter pct={health.pct} />
      <span className="tabular">{health.pct.toFixed(0)}%</span>
      <span className="sr-only">{HEALTH_LABELS[health.status]}</span>
    </span>
  );
}
