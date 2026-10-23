import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { loadSalesReport } from "@/lib/sales/queries";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { DashboardCard, DashboardGrid } from "@/components/dashboard-card";
import { ParamSelect } from "@/components/param-select";
import { MoneyText } from "@/components/money-text";
import { BridgeChart, CandleChart } from "@/components/sales/pipeline-charts";

export const metadata = { title: "Sales report" };

/**
 * Phase 2 · M9 monthly report: candles of the open pipeline (from the daily
 * snapshots) and the pipeline bridge per month (from the stage history).
 * Everything is counted by stage category and shown in IDR.
 */
export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireAccess(perms.viewPipeline);
  const sp = await searchParams;
  const report = await loadSalesReport(user, 6);
  const latest = report.bridges.at(-1)!;
  const bridge = report.bridges.find((b) => b.month === sp.month) ?? latest;
  const money = (v: number) => <MoneyText value={v} currency="IDR" />;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Sales report"
        compact
        actions={
          <>
            <ParamSelect
              param="month"
              ariaLabel="Bridge month"
              value={bridge.month}
              defaultValue={latest.month}
              options={[...report.bridges].reverse().map((b) => ({ value: b.month, label: formatMonth(b.month) }))}
            />
            <LinkButton variant="ghost" size="sm" icon="trend" href="/sales">
              Pipeline
            </LinkButton>
          </>
        }
      />
      <div className="py-6">
      <DashboardGrid>
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
        <DashboardCard title={`Pipeline bridge · ${formatMonth(bridge.month)}`} span="full">
          <BridgeChart bridge={bridge} />
        </DashboardCard>
      </DashboardGrid>
      </div>

      <section className="flex flex-col gap-2 pb-6">
        <h2 className="text-body font-medium">Bridge by month</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-body">
            <thead className="text-muted-foreground text-caption">
              <tr className="border-b">
                {["Month", "Start", "+ New", "− Won", "− Lost", "± Value changes", "End"].map((h, i) => (
                  <th key={h} className={i === 0 ? "px-3 py-2 text-left font-normal" : "px-3 py-2 text-right font-normal"}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.bridges].reverse().map((b) => (
                <tr key={b.month} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{formatMonth(b.month)}</td>
                  {[b.start, b.added, b.won, b.lost, b.adjusted, b.end].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right">
                      {money(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-caption">
          Counted by stage category (Open, Won, Lost), in IDR at the reference rate. Value changes are edits to open deals between stage moves.
          {report.unconverted > 0 && ` ${report.unconverted} open deal${report.unconverted === 1 ? " has" : "s have"} a currency without a rate and ${report.unconverted === 1 ? "isn't" : "aren't"} counted.`}{" "}
          {formatMoney(latest.end, "IDR")} open today.
        </p>
      </section>
    </div>
  );
}
