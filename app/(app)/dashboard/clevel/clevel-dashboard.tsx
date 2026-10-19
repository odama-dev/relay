import { Suspense } from "react";
import { clevelContext, loadFinance, loadProjects, loadUtilization } from "@/lib/clevel/queries";
import { greeting } from "@/lib/dashboard/pure";
import type { CurrentUser } from "@/lib/auth";
import { formatDateLong, formatMoney, formatPercent } from "@/lib/format";
import { timeIn } from "@/lib/time/pure";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/page-skeletons";
import { PeriodSelect } from "./period-select";
import { IncompleteFlag, SectionBody, TargetBadge, idrCompact } from "./parts";
import { FinanceOverviewCard, UtilizationCard } from "./overview-cards";
import { MarginEdgesTable } from "./tables";

/**
 * The C-Level overview (Figma 7939:9978): the period's money in one strip,
 * finance and utilization side by side, then the project portfolio and the
 * best and worst project margins.
 */
export function ClevelDashboard({ user, searchParams }: { user: CurrentUser; searchParams: Record<string, string | string[] | undefined> }) {
  const cc = clevelContext(user, searchParams);
  const firstName = user.fullName.split(" ")[0] || user.fullName;
  const { period } = cc;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`${greeting(timeIn(user.timezone))}, ${firstName}`}
        description={formatDateLong(cc.today)}
        actions={
          <>
            <PeriodSelect kind={period.kind} from={period.kind === "custom" ? period.start : ""} to={period.kind === "custom" ? period.fullEnd : ""} />
            <RefreshButton />
          </>
        }
        className="bleed mb-0"
      />
      <Suspense fallback={<MoneySkeleton />}>
        <SectionBody title="Finance & utilization" load={() => Promise.all([loadFinance(cc), loadUtilization(cc)])}>
          {([f, u]) => <MoneySection f={f} u={u} />}
        </SectionBody>
      </Suspense>
      <section aria-label="Project margins" className="flex flex-col">
        <h2 className="bleed flex min-h-12 items-center border-b text-body font-medium">Top 3 &amp; lowest 3 project margins</h2>
        <Suspense fallback={<ProjectsSkeleton />}>
          <SectionBody title="Projects" load={() => loadProjects(cc)}>
            {(p) => <ProjectsSection p={p} />}
          </SectionBody>
        </Suspense>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money in, out and the team's time
// ---------------------------------------------------------------------------

type Finance = Awaited<ReturnType<typeof loadFinance>>;
type Team = Awaited<ReturnType<typeof loadUtilization>>;

/** "+IDR 1,200,000 (+12.5%)", green when it went the good way. */
function Change({ change, pct, goodWhenUp = true }: { change: number; pct?: number | null; goodWhenUp?: boolean }) {
  if (change === 0) return <span className="text-muted-foreground text-caption">No change vs previous period</span>;
  const up = change > 0;
  return (
    <span className={cn("tabular text-caption font-medium", up === goodWhenUp ? "text-success" : "text-destructive")} title="vs previous period">
      {up ? "+" : "−"}
      {formatMoney(Math.abs(change), "IDR")}
      {pct != null && ` (${up ? "+" : ""}${pct.toFixed(1)}%)`}
    </span>
  );
}

function MoneySection({ f, u }: { f: Finance; u: Team }) {
  const c = f.costs;
  const flag = c.incomplete ? <IncompleteFlag /> : null;
  return (
    <>
      <SummaryStrip
        variant="even"
        items={[
          {
            label: "Revenue received",
            badge: <TargetBadge status={f.revenue.status} />,
            values: [<span key="v" title={formatMoney(f.revenue.value, "IDR")}>{idrCompact(f.revenue.value)}</span>],
            delta: <Change change={f.revenue.change} />,
          },
          {
            label: "Receivables",
            values: [<span key="v" title={formatMoney(f.receivables.estimatedIdr, "IDR")}>{idrCompact(f.receivables.estimatedIdr)}</span>],
            delta: (
              <span className="text-muted-foreground text-caption">
                {f.receivables.count} open request{f.receivables.count === 1 ? "" : "s"} · estimate
                {f.receivables.missingRate.length > 0 && <> · no rate for {f.receivables.missingRate.join(", ")}</>}
              </span>
            ),
          },
          {
            label: "Costs",
            values: [
              <span key="v" title={formatMoney(c.people + c.opex, "IDR")}>
                {idrCompact(c.people + c.opex)}
                {flag}
              </span>,
            ],
            delta: (
              <span className="text-muted-foreground text-caption">
                People {idrCompact(c.people)} · operating {idrCompact(c.opex)}
              </span>
            ),
          },
          {
            label: "Studio margin",
            tone: c.margin.value < 0 ? "destructive" : "default",
            values: [
              <span key="v" title={formatMoney(c.margin.value, "IDR")}>
                {idrCompact(c.margin.value)}
                {flag}
                <span className="text-muted-foreground ml-2 text-subtitle font-normal">{formatPercent(c.margin.pct)}</span>
              </span>,
            ],
            delta: <Change change={c.marginChange.change} pct={c.marginChange.pct} />,
          },
        ]}
      />
      <div className="bleed grid gap-4 border-b py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <FinanceOverviewCard trend={f.trend} />
        <UtilizationCard ranges={u.ranges} />
      </div>
    </>
  );
}

function MoneySkeleton() {
  return (
    <>
      <div className="bleed flex border-b">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col gap-2 px-6 py-4 first:pl-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="bleed grid gap-4 border-b py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[440px] rounded-xl" />
        <Skeleton className="h-[440px] rounded-xl" />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

type Projects = Awaited<ReturnType<typeof loadProjects>>;

function ProjectsSection({ p }: { p: Projects }) {
  const byMargin = [...p.margins].sort((a, b) => b.period.margin - a.period.margin);
  const top = byMargin.slice(0, 3);
  const lowest = byMargin.slice(3).slice(-3);
  const retainers = p.portfolio.byType.find((t) => t.type === "retainer")?.count ?? 0;
  return (
    <>
      <SummaryStrip
        variant="even"
        items={[
          { label: "Active", values: [`${p.portfolio.active} project${p.portfolio.active === 1 ? "" : "s"}`] },
          { label: "Completed", values: [p.portfolio.completed] },
          { label: "Started", values: [p.portfolio.started] },
          { label: "Retainer", values: [retainers] },
          {
            label: "Overdue tasks",
            tone: p.delivery.overdue ? "destructive" : "default",
            values: [p.delivery.overdue],
          },
        ]}
      />
      <MarginEdgesTable rows={[...top, ...lowest]} />
    </>
  );
}

function ProjectsSkeleton() {
  return (
    <>
      <div className="bleed flex border-b">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col gap-2 px-6 py-4 first:pl-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
      <DataTableSkeleton cols={6} rows={6} />
    </>
  );
}
