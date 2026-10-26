"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import type { Candle } from "@/lib/sales/pure";
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

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Band height (of 100) for a step: the first step fills most of the column, an empty one keeps a sliver. */
const bandHeight = (deals: number, top: number) => (top > 0 ? 6 + 74 * (deals / top) : 6);

/** One column's slice of the flow: flat at its own height, then an S-curve down to the next step's. */
function bandPath(from: number, to: number) {
  const t0 = 50 - from / 2;
  const t1 = 50 - to / 2;
  const b0 = 50 + from / 2;
  const b1 = 50 + to / 2;
  return `M0,${t0} L35,${t0} C50,${t0} 50,${t1} 65,${t1} L100.6,${t1} L100.6,${b1} L65,${b1} C50,${b1} 50,${b0} 35,${b0} L0,${b0} Z`;
}

/**
 * Funnel as a flow: one column per step with its name, deals and value on
 * top, and a band below whose height is the deals that reached it, easing
 * into the next step. Deeper steps are a deeper blue (solid mixes, so slices meet without seams); hover or focus marks
 * a column with a blue left line and deepens its band. Percentages are of the first step.
 */
export function FunnelChart({ steps, className }: { steps: { label: string; deals: number; valueIdr: number }[]; className?: string }) {
  const top = steps[0]?.deals ?? 0;
  const last = Math.max(1, steps.length - 1);
  return (
    <figure className={cn("-mx-1 flex overflow-x-auto", className)}>
      {steps.map((s, i) => {
        const h = bandHeight(s.deals, top);
        const next = bandHeight(steps[i + 1]?.deals ?? s.deals, top);
        const share = top > 0 ? Math.round((s.deals / top) * 100) : 0;
        return (
          <div
            key={s.label}
            tabIndex={0}
            aria-label={`${s.label}: ${count(s.deals, "deal")}, ${share}% of the first step, ${idr(s.valueIdr)}`}
            className="group flex min-w-28 flex-1 flex-col outline-none"
            style={{ "--band": `color-mix(in oklch, var(--chart-in) ${Math.round(18 + 72 * (i / last))}%, var(--surface-3))` } as React.CSSProperties}
          >
            <div className={cn("group-hover:border-chart-in group-focus-visible:border-chart-in flex flex-col gap-0.5 border-l px-3 pt-2.5 pb-3 transition-colors duration-150", i === 0 && "border-transparent")}>
              <span className="text-muted-foreground truncate text-caption uppercase tracking-wide">{s.label}</span>
              <span className="tabular text-[20px] leading-tight font-medium">{s.deals}</span>
              <span className="text-muted-foreground tabular truncate text-caption">{axis(s.valueIdr)}</span>
            </div>
            <div className="relative min-h-40 flex-1">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-hidden" aria-hidden>
                {/* The pale halo is a fixed-width stroke, so it stays thin however tall the card is. */}
                <path d={bandPath(h, next)} vectorEffect="non-scaling-stroke" strokeWidth={12} strokeLinejoin="round" style={{ fill: "none", stroke: "color-mix(in oklch, var(--chart-in) 7%, var(--surface-3))" }} />
                <path d={bandPath(h, next)} className="group-hover:fill-chart-in group-focus-visible:fill-chart-in transition-[fill] duration-150 [fill:var(--band)]" />
              </svg>
              <span className="text-muted-foreground tabular absolute right-2 text-caption" style={{ bottom: `calc(${50 + h / 2}% + 10px)` }}>
                {share}%
              </span>
            </div>
          </div>
        );
      })}
    </figure>
  );
}

const blue = (pct: number) => `color-mix(in oklch, var(--chart-in) ${pct}%, var(--surface-3))`;

/**
 * Fixed blue shade per source (colour follows the source, not its rank);
 * neighbouring sources sit far apart on the ramp, and the legend carries the
 * counts so identity never rests on shade alone.
 */
const SOURCE_COLOR: Record<string, string> = {
  dribbble: blue(100),
  referral: blue(40),
  website: blue(75),
  other: blue(20),
  email: blue(55),
  behance: blue(88),
  contra: blue(30),
  unknown: blue(10),
};

/** Lead sources as a pie of leads; the legend carries each source's count and win rate, the tooltip the rest. */
export function SourceChart({
  rows,
  className,
}: {
  rows: { source: string; label: string; leads: number; won: number; lost: number; winRate: number | null; wonIdr: number }[];
  className?: string;
}) {
  const data = [...rows].sort((a, b) => b.leads - a.leads);
  const total = data.reduce((s, r) => s + r.leads, 0);
  const config: ChartConfig = { leads: { label: "Leads", color: "var(--chart-in)" } };
  return (
    <figure className={cn("flex flex-col justify-center gap-3", className)}>
      <ChartContainer config={config} className="aspect-auto min-h-36 w-full flex-1">
        <PieChart>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof data)[number];
              return (
                <TooltipBox
                  title={r.label}
                  rows={[
                    ["Leads", `${r.leads} · ${Math.round((r.leads / total) * 100)}%`],
                    ["Won", String(r.won)],
                    ["Lost", String(r.lost)],
                    ["Win rate (closed)", r.winRate === null ? "—" : `${r.winRate}%`],
                    ["Won value", idr(r.wonIdr)],
                  ]}
                />
              );
            }}
          />
          <Pie data={data} dataKey="leads" nameKey="label" outerRadius="100%" stroke="var(--surface-3)" strokeWidth={2} isAnimationActive={false}>
            {data.map((r) => (
              <Cell key={r.source} fill={SOURCE_COLOR[r.source] ?? blue(30)} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <figcaption className="flex flex-col gap-1 text-caption">
        {data.map((r) => (
          <span key={r.source} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: SOURCE_COLOR[r.source] ?? blue(30) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular">{r.leads}</span>
            <span className="text-muted-foreground tabular w-14 text-right">{r.winRate === null ? "—" : `${r.winRate}% won`}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Money won per month (IDR), one blue bar per month; the tooltip names the deal count. */
export function WonByMonthChart({ data, height = 240, className }: { data: { label: string; title: string; deals: number; valueIdr: number }[]; height?: number; className?: string }) {
  const config: ChartConfig = { valueIdr: { label: "Won", color: "var(--chart-in)" } };
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 0 }} barCategoryGap="32%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={axis} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof data)[number];
              return <TooltipBox title={r.title} rows={[["Won", idr(r.valueIdr)], ["Deals", count(r.deals, "deal")]]} />;
            }}
          />
          <Bar dataKey="valueIdr" fill="var(--chart-in)" radius={4} maxBarSize={36} isAnimationActive={false}>
            <LabelList dataKey="valueIdr" position="top" className="fill-muted-foreground text-caption" formatter={(v: unknown) => (typeof v === "number" && v > 0 ? axis(v) : "")} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
