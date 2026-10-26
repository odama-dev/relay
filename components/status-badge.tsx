"use client";

import { Badge, badgeColors, type BadgeColor } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sentenceEnum } from "@/lib/format";

type Tone = "neutral" | "positive" | "active" | "warning" | "critical";

/** Fluid Badge (dot): a neutral outline and foreground text; only the dot takes the hue. */
const TONE_COLOR: Record<Tone, BadgeColor> = {
  neutral: "gray",
  positive: "green",
  active: "blue",
  warning: "amber",
  critical: "red",
};

const MAP: Record<string, Tone> = {
  // people
  active: "positive",
  invited: "active",
  deactivated: "neutral",
  // project
  on_hold: "warning",
  completed: "neutral",
  archived: "neutral",
  // task
  todo: "neutral",
  in_progress: "active",
  review: "warning",
  done: "positive",
  blocked: "critical",
  // priority
  urgent: "critical",
  high: "warning",
  normal: "neutral",
  low: "neutral",
  // health (lib/health/pure.ts)
  on_track: "positive",
  warning: "warning",
  over_budget: "critical",
  no_budget: "neutral",
  // project schedule (lib/dashboard/pure.ts)
  at_risk: "warning",
  delayed: "critical",
  // out-of-scope + corrections
  pending: "warning",
  approved: "positive",
  rejected: "neutral",
  // invoice + payment request
  draft: "neutral",
  sent: "active",
  partially_paid: "warning",
  payment_submitted: "warning",
  paid: "positive",
  overdue: "critical",
  void: "neutral",
  expired: "critical",
  // client payment (lib/dashboard/pure.ts)
  due_soon: "warning",
  late: "critical",
  // pipeline stage categories + deals (Phase 2 · M9)
  open: "active",
  won: "positive",
  lost: "neutral",
  stale: "warning",
};

/** Labels that differ from the sentence-cased value. */
const LABELS: Record<string, string> = {
  on_track: "On track",
  over_budget: "Over budget",
  no_budget: "No budget",
  todo: "To do",
  // Phase 2: a task is done when its reviewer approves it.
  review: "In review",
  done: "Approved",
};

/** The label a status value reads as, everywhere it is shown. */
export function statusLabel(value: string) {
  return LABELS[value] ?? sentenceEnum(value);
}

export function StatusBadge({
  value,
  label,
  color,
  className,
}: {
  value: string;
  /** Overrides the label, keeping the value's tone. */
  label?: string;
  /** Overrides the dot's hue, e.g. a pipeline stage's own colour. */
  color?: BadgeColor;
  className?: string;
}) {
  const tone = MAP[value] ?? "neutral";
  return (
    <Badge variant="dot" color={color ?? TONE_COLOR[tone]} className={className}>
      {label ?? statusLabel(value)}
    </Badge>
  );
}

/** The hue a status value reads in (badge dot, kanban column dot). */
export function statusColor(value: string) {
  return badgeColors[TONE_COLOR[MAP[value] ?? "neutral"]];
}

/** A pipeline stage's hue: its own colour, else its category's (board column dot, deal badge, stage bar). */
export function stageColor(stage: { color?: string | null; category: string }) {
  return stage.color && stage.color in badgeColors ? badgeColors[stage.color as BadgeColor] : statusColor(stage.category);
}

/**
 * Status as a small circle in the badge's hue — for tables, where a status
 * column would cost a whole column. Hover (or focus) names it in a tooltip.
 */
export function StatusDot({ value, label, className }: { value: string; label?: string; className?: string }) {
  const text = label ?? statusLabel(value);
  return (
    <Tooltip content={text}>
      <span
        role="img"
        aria-label={text}
        tabIndex={0}
        className={cn("inline-block size-1.5 shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-2", className)}
        style={{ backgroundColor: statusColor(value) }}
      />
    </Tooltip>
  );
}
