"use client";

import { Bar, CartesianGrid, Cell, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TrendPoint = { label: string; value: number | null; target?: number | null };
export type TrendFormat = "idr" | "percent" | "count";

/**
 * One measure over time, optionally against its target (C-Level dashboard
 * trends). The actual is a bar (or a line), the target a thin line — two
 * marks, a legend and a tooltip, so identity never rests on the gray alone.
 * Monochrome per the design system: actual chart-1, target chart-3,
 * negative values in the destructive tone.
 */
export function TrendChart({
  data,
  format,
  kind = "bar",
  valueLabel,
  targetLabel = "Target",
  height = 180,
  className,
}: {
  data: TrendPoint[];
  format: TrendFormat;
  kind?: "bar" | "line";
  valueLabel: string;
  targetLabel?: string;
  height?: number;
  className?: string;
}) {
  const hasTarget = data.some((d) => d.target != null);
  const config: ChartConfig = {
    value: { label: valueLabel, color: "var(--chart-1)" },
    target: { label: targetLabel, color: "var(--chart-3)" },
  };
  const fmt = (v: number) => (format === "idr" ? formatMoney(v, "IDR") : format === "percent" ? formatPercent(v) : formatNumber(v));
  const axis = (v: number) =>
    format === "idr" ? formatMoney(v, "IDR", { compact: true }).replace(/IDR\s?/, "") : format === "percent" ? `${Math.round(v)}%` : formatNumber(v);

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      {hasTarget && (
        <figcaption className="text-muted-foreground flex items-center gap-4 text-caption">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-[var(--chart-1)]" aria-hidden />
            {valueLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-[var(--chart-3)]" aria-hidden />
            {targetLabel}
          </span>
        </figcaption>
      )}
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={axis} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as TrendPoint;
              return (
                <div className="bg-popover text-popover-foreground grid min-w-36 gap-1 rounded-lg px-2.5 py-1.5 text-caption shadow-md">
                  <span className="font-medium">{label}</span>
                  <span className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{valueLabel}</span>
                    <span className="tabular">{point.value == null ? "—" : fmt(point.value)}</span>
                  </span>
                  {hasTarget && (
                    <span className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{targetLabel}</span>
                      <span className="tabular">{point.target == null ? "—" : fmt(point.target)}</span>
                    </span>
                  )}
                </div>
              );
            }}
          />
          {kind === "bar" ? (
            <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={(d.value ?? 0) < 0 ? "var(--destructive)" : "var(--color-value)"} />
              ))}
            </Bar>
          ) : (
            <Line dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "var(--color-value)" }} connectNulls isAnimationActive={false} />
          )}
          {hasTarget && <Line dataKey="target" stroke="var(--color-target)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} type="stepAfter" />}
        </ComposedChart>
      </ChartContainer>
    </figure>
  );
}
