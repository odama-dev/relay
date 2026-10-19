import Link from "next/link";
import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { FORECAST_HORIZON, loadFinanceOverview } from "@/lib/finance/queries";
import { AGING_LABELS } from "@/lib/clevel/pure";
import { formatDateLong, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { TrendDelta } from "@/components/trend-delta";
import { ForecastChart } from "./forecast-chart";
import { ExpectedPaymentsTable, ForecastTable } from "./finance-tables";

export const metadata = { title: "Finance Overview" };

const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}T00:00:00Z`));
const compact = (v: number) => formatMoney(v, "IDR", { compact: true });
const caption = "text-muted-foreground text-caption";

/**
 * Money in (Finance, Sales, C-Level): what came in, what's owed, and a
 * revenue forecast for the rest of this month and the next three, built
 * from payment requests, retainer fees and unbilled fixed contracts, with
 * the trend of past revenue beside it (lib/finance/pure.ts).
 */
export default async function FinanceOverviewPage() {
  const user = await requireAccess(perms.viewFinanceOverview);
  const f = await loadFinanceOverview(user);
  const notes = [
    f.forecast.unscheduled.count > 0 &&
      `${f.forecast.unscheduled.count} fixed contract${f.forecast.unscheduled.count === 1 ? "" : "s"} with ${compact(f.forecast.unscheduled.idr)} unbilled and no end date — not in the chart`,
    f.forecast.retainerMissingFee > 0 && `${f.forecast.retainerMissingFee} retainer${f.forecast.retainerMissingFee === 1 ? "" : "s"} without a monthly fee`,
    f.missingRate.length > 0 && `no rate for ${f.missingRate.join(", ")} — those amounts are left out`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col">
      <PageHeader title="Finance overview" description={formatDateLong(f.today)} actions={<RefreshButton />} className="bleed mb-0" />

      <SummaryStrip
        variant="even"
        items={[
          {
            label: "Received this month",
            values: [<span key="v" title={formatMoney(f.received.value, "IDR")}>{compact(f.received.value)}</span>],
            delta: <TrendDelta pct={f.received.change.pct} label="vs last month to date" />,
          },
          {
            label: "Outstanding",
            values: [<span key="v" title={formatMoney(f.outstanding.idr, "IDR")}>{compact(f.outstanding.idr)}</span>],
            delta: <span className={caption}>{f.outstanding.count} open request{f.outstanding.count === 1 ? "" : "s"}</span>,
          },
          {
            label: "Overdue",
            tone: f.overdue.idr > 0 ? "destructive" : "default",
            values: [<span key="v" title={formatMoney(f.overdue.idr, "IDR")}>{compact(f.overdue.idr)}</span>],
            delta: <span className={caption}>{f.overdue.count} request{f.overdue.count === 1 ? "" : "s"} past due</span>,
          },
          {
            label: `Forecast · next ${FORECAST_HORIZON} months`,
            values: [<span key="v" title={formatMoney(f.nextMonths, "IDR")}>{compact(f.nextMonths)}</span>],
            delta: <span className={caption}>Invoiced, retainers & contracts</span>,
          },
          ...(f.expenses
            ? [
                {
                  label: "Expenses this month",
                  values: [<span key="v" title={formatMoney(f.expenses.value, "IDR")}>{compact(f.expenses.value)}</span>],
                  delta: <TrendDelta pct={f.expenses.change.pct} goodWhenUp={false} label="vs last month to date" />,
                },
              ]
            : []),
        ]}
      />

      <div className="bleed grid gap-4 border-b py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <DashboardCard title="Revenue forecast" span="full" className="lg:col-span-1" action={{ label: "Invoices", href: "/invoices" }}>
          <ForecastChart
            showTarget={f.hasTargets}
            data={f.chart.map((c) => ({ ...c, label: monthLabel(c.month), ahead: c.month >= f.forecast.months[0]!.month }))}
          />
          <p className={caption}>
            Last 6 months received, then what&apos;s expected through {monthLabel(f.forecast.months[f.forecast.months.length - 1]!.month)}.{" "}
            {f.trend ? "The dashed trend follows the past 12 months of revenue and isn't added in." : "A trend line appears once there are 3 months of revenue."} In IDR; foreign amounts are estimates.
          </p>
          {notes.length > 0 && <p className="text-warning text-caption">{notes.join(" · ")}</p>}
        </DashboardCard>

        <DashboardCard
          title="Receivables aging"
          span="full"
          className="lg:col-span-1"
          count={f.outstanding.count}
          action={{ label: "Overdue", href: "/invoices?status=overdue" }}
          isEmpty={f.outstanding.count === 0}
          emptyText="Nothing is owed right now."
          emptyIcon="invoices"
        >
          <ul className="flex flex-col gap-1 text-body">
            {f.aging.map((a) => (
              <li key={a.bucket}>
                <Link href={a.bucket === "not_due" ? "/invoices?status=sent" : "/invoices?status=overdue"} className={cn(cardRowClass, "-mx-2 min-h-8")}>
                  <span className={cn("flex-1", a.bucket !== "not_due" && a.count > 0 && "text-destructive")}>{AGING_LABELS[a.bucket]}</span>
                  <span className="tabular w-6 text-right">{a.count}</span>
                  <span className="tabular w-28 text-right">{a.count ? compact(a.idr) : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </DashboardCard>
      </div>

      <section aria-label="Forecast by month" className="flex flex-col">
        <h2 className="bleed flex min-h-12 items-center border-b text-body font-medium">Forecast by month</h2>
        <ForecastTable rows={f.forecast.months.map((m, i) => ({ ...m, received: m.current ? f.received.value : 0, trend: f.trend?.[i] ?? null, target: f.chart.find((c) => c.month === m.month)?.target ?? null }))} showTarget={f.hasTargets} />
      </section>

      <section aria-label="Expected payments" className="flex flex-col">
        <h2 className="bleed flex min-h-12 items-center border-b text-body font-medium">Expected payments · next 90 days</h2>
        <ExpectedPaymentsTable rows={f.expected} />
      </section>
    </div>
  );
}
