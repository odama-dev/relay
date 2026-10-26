"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { countryLabel } from "@/lib/geo/pure";

const blue = (pct: number) => `color-mix(in oklch, var(--chart-in) ${pct}%, var(--surface-3))`;
const EMPTY = "color-mix(in oklch, var(--foreground) 7%, var(--surface-3))";
const plural = (n: number) => `${n} ${n === 1 ? "company" : "companies"}`;

type Props = {
  map: { countries: { name: string; d: string }[]; points: Record<string, [number, number]> };
  width: number;
  height: number;
  rows: { name: string; label: string; count: number }[];
  className?: string;
};

/**
 * Companies per country as a heat map: one blue, deeper for more companies,
 * countries without any in a faint neutral. Countries too small for the
 * map are dots. Hover a country (or a list row) to read its count; the list
 * below names the top countries so nothing rests on shade alone.
 */
export function CountryMap({ map, width, height, rows, className }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const counts = new Map(rows.map((r) => [r.name, r.count]));
  const max = Math.max(1, ...rows.map((r) => r.count));
  const fill = (n: number | undefined) => (n ? blue(Math.round(25 + 75 * (n / max))) : EMPTY);
  const points = rows.filter((r) => map.points[r.name]);
  const shown = active ? `${countryLabel(active)} · ${plural(counts.get(active) ?? 0)}` : null;

  return (
    <figure className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative aspect-[960/440] lg:aspect-auto lg:min-h-24 lg:flex-1">
        <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 size-full" role="img" aria-label="Companies per country" onMouseLeave={() => setActive(null)}>
          {map.countries.map((c) => (
            <path
              key={c.name}
              d={c.d}
              fill={fill(counts.get(c.name))}
              stroke="var(--surface-3)"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
              className={cn("transition-[fill] duration-150", active === c.name && "fill-foreground/60")}
              onMouseEnter={() => setActive(c.name)}
            />
          ))}
          {points.map((r) => {
            const [x, y] = map.points[r.name]!;
            return (
              <circle
                key={r.name}
                cx={x}
                cy={y}
                r={10}
                fill={fill(r.count)}
                stroke="var(--surface-3)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className={cn(active === r.name && "fill-foreground/60")}
                onMouseEnter={() => setActive(r.name)}
              />
            );
          })}
        </svg>
        {shown && <span className="bg-popover text-popover-foreground pointer-events-none absolute top-0 left-0 rounded-md px-2 py-1 text-caption shadow-md">{shown}</span>}
      </div>
      <figcaption className="flex items-center gap-2 text-caption">
        <span className="text-muted-foreground tabular">1</span>
        <span className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${blue(25)}, ${blue(100)})` }} aria-hidden />
        <span className="text-muted-foreground tabular">{max}</span>
      </figcaption>
      <ul className="flex flex-col gap-1 text-caption">
        {rows.slice(0, 4).map((r) => (
          <li key={r.name} className="flex items-center gap-2" onMouseEnter={() => setActive(r.name)} onMouseLeave={() => setActive(null)}>
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: fill(r.count) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular">{r.count}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
