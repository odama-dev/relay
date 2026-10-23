"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import type { Bridge, Candle } from "@/lib/sales/pure";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const idr = (v: number) => formatMoney(v, "IDR");
const axis = (v: number) => formatMoney(v, "IDR", { compact: true }).replace(/IDR\s?/, "");

function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <figcaption className="text-muted-foreground flex flex-wrap items-center gap-4 text-caption">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={i.line ? "h-0.5 w-3 rounded" : "size-2.5 rounded-[3px]"} style={{ background: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </figcaption>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="bg-popover text-popover-foreground grid min-w-40 gap-1 rounded-lg px-2.5 py-1.5 text-caption shadow-md">
      <span className="font-medium">{title}</span>
      {rows.map(([k, v]) => (
        <span key={k} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{k}</span>
          <span className="tabular">{v}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Open pipeline per month as candles (PRD "Report bulanan"): the thin wick
 * spans the month's low to high, the body its first to last day. A rising
 * month is the "in" tone, a falling one the "out" tone — and the tooltip
 * says which, so it never rests on colour.
 */
export function CandleChart({ data, height = 240, className }: { data: (Candle & { label: string; title: string })[]; height?: number; className?: string }) {
  const rows = data.map((c) => ({ ...c, wick: [c.low, c.high] as [number, number], body: [Math.min(c.open, c.close), Math.max(c.open, c.close) || 1] as [number, number], up: c.close >= c.open }));
  const config: ChartConfig = { body: { label: "Open → close", color: "var(--chart-in)" } };
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <Legend
        items={[
          { label: "Rose over the month", color: "var(--chart-in)" },
          { label: "Fell over the month", color: "var(--chart-out)" },
          { label: "Low – high", color: "var(--chart-3)", line: true },
        ]}
      />
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="40%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis xAxisId="body" dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <XAxis xAxisId="wick" dataKey="label" hide />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={axis} domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const c = payload[0]!.payload as (typeof rows)[number];
              return (
                <TooltipBox
                  title={`${c.title} · ${c.up ? "rose" : "fell"}`}
                  rows={[
                    ["Open", idr(c.open)],
                    ["High", idr(c.high)],
                    ["Low", idr(c.low)],
                    ["Close", idr(c.close)],
                    ["Days recorded", String(c.days)],
                  ]}
                />
              );
            }}
          />
          <Bar xAxisId="wick" dataKey="wick" maxBarSize={2} fill="var(--chart-3)" isAnimationActive={false} />
          <Bar xAxisId="body" dataKey="body" maxBarSize={20} radius={4} isAnimationActive={false}>
            {rows.map((c, i) => (
              <Cell key={i} fill={c.up ? "var(--chart-in)" : "var(--chart-out)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  );
}

/**
 * Pipeline bridge (waterfall) for one month: start, + new, − won, − lost,
 * ± value changes, = end. Totals are solid; steps float from where the
 * previous one ended, additions in the "in" tone, removals in the "out" tone.
 */
export function BridgeChart({ bridge, height = 240, className }: { bridge: Bridge; height?: number; className?: string }) {
  const step = (name: string, from: number, delta: number) => ({
    name,
    range: [Math.min(from, from + delta), Math.max(from, from + delta)] as [number, number],
    value: delta,
    kind: delta >= 0 ? "in" : "out",
  });
  const afterNew = bridge.start + bridge.added;
  const afterWon = afterNew - bridge.won;
  const afterLost = afterWon - bridge.lost;
  const rows = [
    { name: "Start", range: [0, bridge.start] as [number, number], value: bridge.start, kind: "total" },
    step("New", bridge.start, bridge.added),
    step("Won", afterNew, -bridge.won),
    step("Lost", afterWon, -bridge.lost),
    step("Value changes", afterLost, bridge.adjusted),
    { name: "End", range: [0, bridge.end] as [number, number], value: bridge.end, kind: "total" },
  ];
  const color = (kind: string) => (kind === "total" ? "var(--chart-1)" : kind === "in" ? "var(--chart-in)" : "var(--chart-out)");
  const config: ChartConfig = { range: { label: "Pipeline", color: "var(--chart-1)" } };
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <Legend
        items={[
          { label: "Pipeline value", color: "var(--chart-1)" },
          { label: "Added", color: "var(--chart-in)" },
          { label: "Taken out", color: "var(--chart-out)" },
        ]}
      />
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={rows} margin={{ top: 20, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={axis} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof rows)[number];
              return <TooltipBox title={r.name} rows={[[r.kind === "total" ? "Open pipeline" : r.value >= 0 ? "Added" : "Taken out", idr(Math.abs(r.value))]]} />;
            }}
          />
          <Bar dataKey="range" maxBarSize={36} radius={4} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell key={i} fill={color(r.kind)} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              className="fill-muted-foreground text-caption"
              formatter={(v: unknown) => (typeof v === "number" && v !== 0 ? `${v < 0 ? "−" : ""}${axis(Math.abs(v))}` : "")}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
