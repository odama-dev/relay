"use client";

import { useId } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ForecastPoint = {
  label: string;
  /** This month or later: has forecast parts. */
  ahead: boolean;
  actual: number;
  invoiced: number;
  overdue: number;
  retainer: number;
  contract: number;
  draft: number;
  trend: number | null;
  target: number | null;
};

/** Received in solid blue; what's expected in steps of the same blue, overdue in the warning tone. Everything expected is hatched. */
const SERIES = [
  { key: "actual", label: "Received", color: "var(--chart-in)", opacity: 1 },
  { key: "invoiced", label: "Invoiced", color: "var(--chart-in)", opacity: 0.6 },
  { key: "overdue", label: "Overdue", color: "var(--warning)", opacity: 0.85 },
  { key: "retainer", label: "Retainer", color: "var(--chart-in)", opacity: 0.4 },
  { key: "contract", label: "Contract remaining", color: "var(--chart-in)", opacity: 0.25 },
  { key: "draft", label: "Draft", color: "var(--chart-in)", opacity: 0.12 },
] as const;

const config: ChartConfig = Object.fromEntries([
  ...SERIES.map((s) => [s.key, { label: s.label, color: s.color }]),
  ["trend", { label: "Trend", color: "var(--foreground)" }],
  ["target", { label: "Target", color: "var(--chart-3)" }],
]);

/** Stripes sit this much more opaque than the segment's own fill. */
const STRIPE_LIFT = 0.35;
const tint = (color: string, opacity: number) => `color-mix(in oklab, ${color} ${Math.round(opacity * 100)}%, transparent)`;
const swatch = (s: (typeof SERIES)[number]) =>
  s.key === "actual"
    ? tint(s.color, s.opacity)
    : `repeating-linear-gradient(-45deg, ${tint(s.color, Math.min(1, s.opacity + STRIPE_LIFT))} 0 1.5px, ${tint(s.color, s.opacity)} 1.5px 4px)`;

const idr = (v: number) => formatMoney(v, "IDR");
const compact = (v: number) => formatMoney(v, "IDR", { compact: true }).replace(/IDR\s?/, "");

/**
 * Revenue: the last months received, then what's expected this month and
 * the next ones, stacked by where it comes from. The dashed line is the
 * trend of past revenue (not added in); the step line is the target.
 */
export function ForecastChart({ data, showTarget, height = 320, className }: { data: ForecastPoint[]; showTarget: boolean; height?: number; className?: string }) {
  const hasTrend = data.some((d) => d.trend !== null);
  const used = SERIES.filter((s) => data.some((d) => d[s.key] > 0));
  const patternId = useId().replace(/:/g, "");
  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
        {used.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: swatch(s) }} aria-hidden />
            {s.label}
          </span>
        ))}
        {hasTrend && (
          <span className="flex items-center gap-1.5">
            <span className="border-foreground w-3 border-t-2 border-dashed" aria-hidden />
            Trend
          </span>
        )}
        {showTarget && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-[var(--chart-3)]" aria-hidden />
            Target
          </span>
        )}
      </figcaption>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="30%">
          <defs>
            {SERIES.filter((s) => s.key !== "actual").map((s) => (
              <pattern key={s.key} id={`${patternId}-${s.key}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={5} height={5} fill={s.color} fillOpacity={s.opacity} />
                <line x1={0} y1={0} x2={0} y2={5} stroke={s.color} strokeOpacity={Math.min(1, s.opacity + STRIPE_LIFT)} strokeWidth={1.5} />
              </pattern>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval={0} />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compact} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as ForecastPoint;
              const expected = p.invoiced + p.overdue + p.retainer + p.contract + p.draft;
              return (
                <div className="bg-popover text-popover-foreground grid min-w-48 gap-1 rounded-lg px-2.5 py-1.5 text-caption shadow-md">
                  <span className="font-medium">{label}</span>
                  {SERIES.filter((s) => p[s.key] > 0).map((s) => (
                    <span key={s.key} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="tabular">{idr(p[s.key])}</span>
                    </span>
                  ))}
                  {p.ahead && (
                    <span className="flex justify-between gap-3 border-t pt-1">
                      <span className="text-muted-foreground">{p.actual > 0 ? "Received + expected" : "Expected"}</span>
                      <span className="tabular font-medium">{idr(p.actual + expected)}</span>
                    </span>
                  )}
                  {p.trend !== null && (
                    <span className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Trend</span>
                      <span className="tabular">{idr(p.trend)}</span>
                    </span>
                  )}
                  {showTarget && p.target !== null && (
                    <span className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Target</span>
                      <span className="tabular">{idr(p.target)}</span>
                    </span>
                  )}
                </div>
              );
            }}
          />
          {SERIES.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="revenue"
              fill={s.key === "actual" ? s.color : `url(#${patternId}-${s.key})`}
              fillOpacity={s.key === "actual" ? s.opacity : 1}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
          {hasTrend && <Line dataKey="trend" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />}
          {showTarget && <Line dataKey="target" stroke="var(--chart-3)" strokeWidth={2} dot={false} connectNulls type="stepAfter" isAnimationActive={false} />}
        </ComposedChart>
      </ChartContainer>
    </figure>
  );
}
