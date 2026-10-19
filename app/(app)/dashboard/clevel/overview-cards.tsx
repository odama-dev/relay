"use client";

import { useState } from "react";
import type { UserRole } from "@prisma/client";
import { roleLabel } from "@/lib/roles";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { PillSelect } from "@/components/pill-select";
import { CardFigure, DashboardCard } from "@/components/dashboard-card";
import { InOutChart } from "@/components/in-out-chart";
import { RING_STEPS, UtilizationRing } from "@/components/utilization-ring";

const idrCompact = (v: number) => formatMoney(v, "IDR", { compact: true });
const monthLabel = (m: string, withYear = false) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", ...(withYear && { year: "2-digit" }), timeZone: "UTC" }).format(new Date(`${m}T00:00:00Z`));

const FINANCE_RANGES = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "1 year" },
  { value: "all", label: "All time" },
] as const;
type FinanceRange = (typeof FINANCE_RANGES)[number]["value"];

/** Revenue, operating costs and margin over the chosen range, over money in vs out per month. */
export function FinanceOverviewCard({
  trend,
}: {
  trend: { month: string; revenue: number; opex: number; costs: number; margin: number; incomplete: boolean }[];
}) {
  const [range, setRange] = useState<FinanceRange>("12");
  const shown = range === "all" ? trend : trend.slice(-Number(range));
  const sum = (k: "revenue" | "opex" | "margin") => shown.reduce((s, t) => s + t[k], 0);
  const revenue = sum("revenue");
  const operating = sum("opex");
  const margin = sum("margin");
  const marginIncomplete = shown.some((t) => t.incomplete);
  const data = shown.map((t) => ({ label: monthLabel(t.month, shown.length > 12), in: t.revenue, out: t.costs }));
  return (
    <DashboardCard
      title="Finance overview"
      span="full"
      className="lg:col-span-1"
      action={
        <Tabs value={range} onValueChange={(v) => setRange(v as FinanceRange)} size="compact">
          <TabsList aria-label="Finance range">
            {FINANCE_RANGES.map((r) => (
              <TabItem key={r.value} value={r.value} label={r.label} />
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        <CardFigure label="Revenue" value={idrCompact(revenue)} />
        <CardFigure label="Operating" value={idrCompact(operating)} />
        <CardFigure
          label="Margin"
          value={
            <span className={cn(margin < 0 && "text-destructive")} title={marginIncomplete ? "Cost data is incomplete" : undefined}>
              {idrCompact(margin)}
              {marginIncomplete && <span className="text-warning">*</span>}
            </span>
          }
        />
      </div>
      <InOutChart data={data} height={300} className="mt-2" />
    </DashboardCard>
  );
}

type Agg = { utilization: number | null; target: number | null; billable: number; people: number };
type RoleAgg = Agg & { role: UserRole };

/** Studio utilization over the last 1, 3 or 6 months as a ring split by role, with each role's rate. */
export function UtilizationCard({
  ranges,
}: {
  /** One view per range; `change` is in points vs the same number of months before. */
  ranges: { months: number; studio: Agg; roles: RoleAgg[]; change: number }[];
}) {
  const [months, setMonths] = useState("1");
  const view = ranges.find((r) => String(r.months) === months) ?? ranges[0]!;
  const roles = [...view.roles].sort((a, b) => b.billable - a.billable);
  const s = view.studio;
  const change = view.change;
  return (
    <DashboardCard
      title="Studio utilization"
      span="full"
      className="lg:col-span-1"
      action={
        <PillSelect
          ariaLabel="Utilization range"
          value={months}
          options={ranges.map((r) => ({ value: String(r.months), label: r.months === 1 ? "1 month" : `${r.months} months` }))}
          onChange={setMonths}
        />
      }
    >
      <div className="flex justify-center py-2">
        <UtilizationRing
          value={s.utilization}
          segments={roles.map((r) => ({ key: r.role, label: `${roleLabel(r.role)}: ${formatPercent(r.utilization, 1)}`, weight: r.billable }))}
          label={`Studio utilization ${formatPercent(s.utilization, 1)}`}
        >
          <span className="flex flex-col items-center gap-1">
            <span className="text-muted-foreground text-caption">Utilization</span>
            <span className="tabular text-[18px] leading-tight font-medium">{formatPercent(s.utilization, 1)}</span>
            {change !== 0 && (
              <span className={cn("tabular text-caption font-medium", change > 0 ? "text-success" : "text-destructive")}>
                {change > 0 ? "+" : ""}
                {change.toFixed(1)} pts
              </span>
            )}
          </span>
        </UtilizationRing>
      </div>
      <ul className="flex flex-col gap-2 text-body">
        {roles.map((r, i) => {
          const low = r.utilization !== null && r.target !== null && r.utilization < r.target - 15;
          const high = r.utilization !== null && r.target !== null && r.utilization > r.target + 15;
          return (
            <li key={r.role} className="flex min-h-5 items-center gap-2.5">
              <span className="bg-chart-in size-2 shrink-0 rounded-full" style={{ opacity: RING_STEPS[Math.min(i, RING_STEPS.length - 1)] }} aria-hidden />
              <span className="truncate font-medium">{roleLabel(r.role)}</span>
              <span className="text-muted-foreground shrink-0 text-caption">
                {r.people} {r.people === 1 ? "person" : "people"}
              </span>
              <span className={cn("tabular ml-auto", low && "text-warning", high && "text-destructive")} title={r.target !== null ? `Target ${formatPercent(r.target)}` : undefined}>
                {formatPercent(r.utilization)}
              </span>
            </li>
          );
        })}
      </ul>
    </DashboardCard>
  );
}
