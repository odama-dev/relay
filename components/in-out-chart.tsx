"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatHoursValue, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type InOutPoint = { label: string; in: number; out: number };

const FORMAT = {
  idr: {
    axis: (v: number) => `${v < 0 ? "−" : ""}${formatMoney(Math.abs(v), "IDR", { compact: true }).replace(/IDR\s?/, "")}`,
    full: (v: number) => formatMoney(v, "IDR"),
  },
  hours: { axis: (v: number) => `${Math.round(v * 10) / 10}h`, full: (v: number) => formatHoursValue(v) },
};

/**
 * Two money measures per month on one shared axis (C-Level overview, Figma 7939:9978).
 * "mirror" (default): revenue rises above the zero line in blue, costs fall
 * below it in red, so the gap between the two reads as the margin.
 * "grouped": both measures side by side above zero — the first in a light
 * tint, the second in solid blue (e.g. invoiced vs collected) — and the
 * tooltip shows the gap between them. Values are IDR, or hours (decimal).
 * `height="fill"` takes the rest of a fixed-height parent (at least 240px).
 */
export function InOutChart({
  data,
  height = 300,
  layout = "mirror",
  labels = { in: "Revenue", out: "Costs", gap: "Margin" },
  format = "idr",
  className,
}: {
  data: InOutPoint[];
  height?: number | "fill";
  layout?: "mirror" | "grouped";
  labels?: { in: string; out: string; gap: string };
  format?: keyof typeof FORMAT;
  className?: string;
}) {
  const grouped = layout === "grouped";
  const f = FORMAT[format];
  const config: ChartConfig = {
    in: { label: labels.in, color: "var(--chart-in)" },
    out: { label: labels.out, color: grouped ? "var(--chart-in)" : "var(--chart-out)" },
  };
  const rows = grouped ? data : data.map((d) => ({ ...d, out: -Math.abs(d.out) }));
  const swatch = { in: grouped ? "bg-chart-in/30" : "bg-chart-in", out: grouped ? "bg-chart-in" : "bg-chart-out" };
  return (
    <figure className={cn("flex flex-col gap-2", height === "fill" && "min-h-0", className)}>
      <figcaption className="text-muted-foreground flex items-center gap-4 text-caption">
        {(["in", "out"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[3px]", swatch[k])} aria-hidden />
            {labels[k]}
          </span>
        ))}
      </figcaption>
      <ChartContainer config={config} className={cn("aspect-auto w-full", height === "fill" && "min-h-60 flex-1")} style={height === "fill" ? undefined : { height }}>
        <BarChart data={rows} stackOffset={grouped ? undefined : "sign"} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={grouped ? "28%" : "34%"} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
          <ReferenceLine y={0} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval={data.length > 12 ? "preserveStartEnd" : 0} minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={f.axis} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as InOutPoint;
              return (
                <div className="bg-popover text-popover-foreground grid min-w-40 gap-1 rounded-lg px-2.5 py-1.5 text-caption shadow-md">
                  <span className="font-medium">{label}</span>
                  <span className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{labels.in}</span>
                    <span className="tabular">{f.full(p.in)}</span>
                  </span>
                  <span className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{labels.out}</span>
                    <span className="tabular">{f.full(Math.abs(p.out))}</span>
                  </span>
                  <span className="flex justify-between gap-3 border-t pt-1">
                    <span className="text-muted-foreground">{labels.gap}</span>
                    <span className="tabular">{f.full(p.in - Math.abs(p.out))}</span>
                  </span>
                </div>
              );
            }}
          />
          <Bar dataKey="in" stackId={grouped ? undefined : "money"} fill="var(--color-in)" fillOpacity={grouped ? 0.3 : 1} radius={4} maxBarSize={24} isAnimationActive={false} />
          <Bar dataKey="out" stackId={grouped ? undefined : "money"} fill="var(--color-out)" radius={4} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
