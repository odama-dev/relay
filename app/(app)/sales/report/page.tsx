import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { loadSalesInsights, loadSalesReport } from "@/lib/sales/queries";
import { addMonths, isIsoDate, monthStart, todayIn } from "@/lib/time/pure";
import { PeriodFilter } from "@/components/period-filter";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { DashboardCard, DashboardGrid } from "@/components/dashboard-card";
import { ParamSelect } from "@/components/param-select";
import { BridgeChart, CandleChart, FunnelChart, SourceChart, WonByMonthChart } from "@/components/sales/pipeline-charts";

export const metadata = { title: "Sales report" };

/**
 * Sales report: the funnel and lead sources over the leads that came in
 * within the period, money won per month, then the open pipeline's candles
 * (daily snapshots) and a month's bridge (stage history). All in IDR.
 */
export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string }> }) {
  const user = await requireAccess(perms.viewPipeline);
  const sp = await searchParams;
  const today = todayIn(user.timezone);
  const iso = (v?: string) => (v && isIsoDate(v) ? v : undefined);
  const from = iso(sp.from) ?? addMonths(monthStart(today), -5);
  const to = iso(sp.to) ?? today;
  const [report, insights] = await Promise.all([loadSalesReport(user, 6), loadSalesInsights(user, from, to)]);
  const latest = report.bridges.at(-1)!;
  const bridge = report.bridges.find((b) => b.month === sp.month) ?? latest;
  const wonTotal = insights.won.reduce((s, m) => s + m.valueIdr, 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Sales report"
        compact
        actions={
          <>
            <PeriodFilter from={sp.from} to={sp.to} label="Report period" placeholder="Last 6 months" />
            <LinkButton variant="ghost" size="sm" icon="trend" href="/sales">
              Pipeline
            </LinkButton>
          </>
        }
      />
      <div className="py-6">
        <DashboardGrid>
          <DashboardCard
            title="Funnel"
            isEmpty={insights.leads === 0}
            emptyText="No leads came in during this period."
            emptyIcon="target"
          >
            <FunnelChart steps={insights.funnel} />
            <p className="text-muted-foreground text-caption">
              {insights.leads} lead{insights.leads === 1 ? "" : "s"} in {formatDate(from)} – {formatDate(to)}. A deal counts at every step it reached, even one it skipped.
            </p>
          </DashboardCard>
          <DashboardCard title="Lead sources" isEmpty={insights.sources.length === 0} emptyText="No leads came in during this period." emptyIcon="target">
            <SourceChart rows={insights.sources} />
            <p className="text-muted-foreground text-caption">Leads that came in during the period; win rate counts the closed ones.</p>
          </DashboardCard>
          <DashboardCard title={`Money won per month · ${formatMoney(wonTotal, "IDR", { compact: true })}`} span="full">
            <WonByMonthChart data={insights.won.map((m) => ({ ...m, label: formatMonth(m.month).split(" ")[0]!, title: formatMonth(m.month) }))} />
            <p className="text-muted-foreground text-caption">
              Value of deals moved to a Won stage, by the month they closed, in IDR at the reference rate.
              {insights.unconverted > 0 && ` ${insights.unconverted} deal${insights.unconverted === 1 ? " has" : "s have"} a currency without a rate and ${insights.unconverted === 1 ? "isn't" : "aren't"} counted.`}
            </p>
          </DashboardCard>
          <DashboardCard
            title="Open pipeline per month"
            span="full"
            isEmpty={report.candles.length === 0}
            emptyText="Recorded daily from now on. Candles appear after the first snapshot — earlier months can't be rebuilt."
            emptyIcon="trend"
          >
            <CandleChart data={report.candles.map((c) => ({ ...c, label: formatMonth(c.month).split(" ")[0]!, title: formatMonth(c.month) }))} />
            {report.firstSnapshot && <p className="text-muted-foreground text-caption">Daily snapshots since {formatDate(report.firstSnapshot)}.</p>}
          </DashboardCard>
          <DashboardCard
            title={`Pipeline bridge · ${formatMonth(bridge.month)}`}
            span="full"
            action={
              <ParamSelect
                param="month"
                ariaLabel="Bridge month"
                value={bridge.month}
                defaultValue={latest.month}
                options={[...report.bridges].reverse().map((b) => ({ value: b.month, label: formatMonth(b.month) }))}
              />
            }
          >
            <BridgeChart bridge={bridge} />
          </DashboardCard>
        </DashboardGrid>
      </div>
    </div>
  );
}
