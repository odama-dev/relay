"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type InOutPoint = { label: string; in: number; out: number };

const config: ChartConfig = {
  in: { label: "Revenue", color: "var(--chart-in)" },
  out: { label: "Costs", color: "var(--chart-out)" },
};

const compact = (v: number) => `${v < 0 ? "−" : ""}${formatMoney(Math.abs(v), "IDR", { compact: true }).replace(/IDR\s?/, "")}`;

/**
 * Money in against money out per month (C-Level overview, Figma 7939:9978):
 * revenue rises above the zero line in blue, costs fall below it in red, on
 * one shared axis so the gap between the two reads as the margin.
 */
export function InOutChart({ data, height = 300, className }: { data: InOutPoint[]; height?: number; className?: string }) {
  const rows = data.map((d) => ({ ...d, out: -Math.abs(d.out) }));
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <figcaption className="text-muted-foreground flex items-center gap-4 text-caption">
        {(["in", "out"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[3px]", k === "in" ? "bg-chart-in" : "bg-chart-out")} aria-hidden />
            {config[k]!.label}
          </span>
        ))}
      </figcaption>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={rows} stackOffset="sign" margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="34%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
          <ReferenceLine y={0} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval={data.length > 12 ? "preserveStartEnd" : 0} minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compact} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as InOutPoint;
              return (
                <div className="bg-popover text-popover-foreground grid min-w-40 gap-1 rounded-lg px-2.5 py-1.5 text-caption shadow-md">
                  <span className="font-medium">{label}</span>
                  <span className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Revenue</span>
                    <span className="tabular">{formatMoney(p.in, "IDR")}</span>
                  </span>
                  <span className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Costs</span>
                    <span className="tabular">{formatMoney(Math.abs(p.out), "IDR")}</span>
                  </span>
                  <span className="flex justify-between gap-3 border-t pt-1">
                    <span className="text-muted-foreground">Margin</span>
                    <span className="tabular">{formatMoney(p.in - Math.abs(p.out), "IDR")}</span>
                  </span>
                </div>
              );
            }}
          />
          <Bar dataKey="in" stackId="money" fill="var(--color-in)" radius={4} maxBarSize={24} isAnimationActive={false} />
          <Bar dataKey="out" stackId="money" fill="var(--color-out)" radius={4} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
