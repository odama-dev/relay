import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { formatDate, formatMoney, formatMonth, formatMonthAbbr } from "@/lib/format";
import { loadCompanyCountries, loadFirstLeadDate, loadSalesInsights, loadSalesReport } from "@/lib/sales/queries";
import { reportPeriod } from "@/lib/sales/pure";
import { MAP_HEIGHT, MAP_WIDTH, worldMap } from "@/lib/geo/world-map";
import { isIsoDate, todayIn } from "@/lib/time/pure";
import { ReportPeriodFilter } from "@/components/sales/report-period-filter";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { DashboardCard, DashboardGrid } from "@/components/dashboard-card";
import { CandleChart, FunnelChart, SourceChart, WonByMonthChart } from "@/components/sales/pipeline-charts";
import { CountryMap } from "@/components/sales/country-map";

export const metadata = { title: "Sales report" };

/**
 * Sales report: the funnel and lead sources over every lead, client
 * countries, then money won per month and the open pipeline's candles (daily
 * snapshots) side by side for the period — a preset (3M, 6M, 1Y, All time)
 * or a custom date range, which scopes only those two. All in IDR.
 */
export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const user = await requireAccess(perms.viewPipeline);
  const sp = await searchParams;
  const today = todayIn(user.timezone);
  const iso = (v?: string) => (v && isIsoDate(v) ? v : undefined);
  const period = reportPeriod({ range: sp.range, from: iso(sp.from), to: iso(sp.to) }, today, sp.range === "all" ? await loadFirstLeadDate(user) : null);
  const { from, to } = period;
  const [report, insights, countries] = await Promise.all([loadSalesReport(user, from, to), loadSalesInsights(user, from, to), loadCompanyCountries(user)]);
  const wonTotal = insights.won.reduce((s, m) => s + m.valueIdr, 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Sales report"
        compact
        actions={
          <>
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
            span="major"
            className="lg:h-[75vh]"
            isEmpty={insights.leads === 0}
            emptyText="No leads yet."
            emptyIcon="target"
          >
            <FunnelChart steps={insights.funnel} className="flex-1" />
            <p className="text-muted-foreground text-caption">
              {insights.leads} lead{insights.leads === 1 ? "" : "s"}, all time. A deal counts at every step it reached, even one it skipped.
            </p>
          </DashboardCard>
          <div className="flex flex-col gap-3 lg:col-span-3 lg:h-[75vh]">
            <DashboardCard title="Lead sources" span="minor" className="lg:min-h-0 lg:flex-1" isEmpty={insights.sources.length === 0} emptyText="No leads yet." emptyIcon="target">
              <SourceChart rows={insights.sources} className="min-h-0 flex-1" />
            </DashboardCard>
            <DashboardCard
              title="Company countries"
              span="minor"
              className="lg:min-h-0 lg:flex-1"
              isEmpty={countries.rows.length === 0}
              emptyText="No company has a country yet."
              emptyIcon="globe"
            >
              <CountryMap map={worldMap()} width={MAP_WIDTH} height={MAP_HEIGHT} rows={countries.rows} className="flex-1" />
              {countries.unknown > 0 && (
                <p className="text-muted-foreground text-caption">
                  {countries.unknown} {countries.unknown === 1 ? "company has" : "companies have"} no country.
                </p>
              )}
            </DashboardCard>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 lg:col-span-12">
            <h2 className="text-subtitle font-semibold">
              Over time <span className="text-muted-foreground font-normal">· {formatDate(from)} – {formatDate(to)}</span>
            </h2>
            <ReportPeriodFilter range={period.range} from={iso(sp.from)} to={iso(sp.to)} />
          </div>
          <DashboardCard title={`Money won per month · ${formatMoney(wonTotal, "IDR", { compact: true })}`} span="half" className="self-stretch">
            <WonByMonthChart data={insights.won.map((m) => ({ ...m, label: formatMonthAbbr(m.month), title: formatMonth(m.month) }))} />
            <p className="text-muted-foreground text-caption">
              Value of deals moved to a Won stage, by the month they closed, in IDR at the reference rate.
              {insights.unconverted > 0 && ` ${insights.unconverted} deal${insights.unconverted === 1 ? " has" : "s have"} a currency without a rate and ${insights.unconverted === 1 ? "isn't" : "aren't"} counted.`}
            </p>
          </DashboardCard>
          <DashboardCard
            title="Open pipeline per month"
            span="half"
            className="self-stretch"
            isEmpty={report.candles.length === 0}
            emptyText="Recorded daily from now on. Candles appear after the first snapshot — earlier months can't be rebuilt."
            emptyIcon="trend"
          >
            <CandleChart data={report.candles.map((c) => ({ ...c, label: formatMonthAbbr(c.month), title: formatMonth(c.month) }))} />
            {report.firstSnapshot && <p className="text-muted-foreground text-caption">Daily snapshots since {formatDate(report.firstSnapshot)}.</p>}
          </DashboardCard>
        </DashboardGrid>
      </div>
    </div>
  );
}
