import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Steps of the one ring colour, strongest first (Figma 7939:9978). */
export const RING_STEPS = [1, 0.7, 0.55, 0.4, 0.3, 0.2] as const;

/**
 * Utilization as a ring: the filled arc is the studio's utilization (capped
 * at a full ring), split into one segment per group in proportion to its
 * billable hours; the rest of the ring is the unused track. `children` sit
 * in the middle.
 */
export function UtilizationRing({
  value,
  segments,
  size = 240,
  stroke = 14,
  label,
  className,
  children,
}: {
  /** 0–100+, the filled share of the ring. */
  value: number | null;
  segments: { key: string; label: string; weight: number }[];
  size?: number;
  stroke?: number;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(value ?? 0, 100)) / 100;
  const total = segments.reduce((s, x) => s + Math.max(0, x.weight), 0);
  // Round caps reach past each end, so leave a gap of one stroke between segments.
  const gap = stroke * 1.4;
  let offset = 0;
  const arcs = total > 0 && filled > 0
    ? segments
        .map((s, i) => ({ ...s, step: RING_STEPS[Math.min(i, RING_STEPS.length - 1)]!, len: (Math.max(0, s.weight) / total) * filled * c }))
        .filter((s) => s.len > 0)
        .map((s) => {
          const start = offset;
          offset += s.len;
          return { ...s, start };
        })
    : [];
  const many = arcs.length > 1 || filled < 1;

  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--active)" strokeWidth={stroke} />
        {arcs.map((a) => {
          const len = Math.max(0.01, many ? a.len - gap : a.len);
          return (
            <circle
              key={a.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--chart-in)"
              strokeOpacity={a.step}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-(a.start + (many ? gap / 2 : 0))}
            >
              <title>{a.label}</title>
            </circle>
          );
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
