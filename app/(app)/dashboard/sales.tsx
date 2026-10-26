import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import { perms, roleLabel } from "@/lib/roles";
import {
  dashboardContext,
  loadActiveClients,
  loadDraftInvoices,
  loadMyInvoices,
  loadSalesSummary,
  loadUninvoicedProjects,
} from "@/lib/dashboard/queries";
import { greeting } from "@/lib/dashboard/pure";
import { loadCompanyCountries, loadSalesInsights } from "@/lib/sales/queries";
import { DEFAULT_REPORT_RANGE, REPORT_RANGES, type ReportRange } from "@/lib/sales/pure";
import { MAP_HEIGHT, MAP_WIDTH, worldMap } from "@/lib/geo/world-map";
import { formatDate, formatDateLong, formatDateShort, formatMoney, humanizeEnum } from "@/lib/format";
import { timeIn } from "@/lib/time/pure";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { CardList, DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { InOutChart } from "@/components/in-out-chart";
import { MoneyText } from "@/components/money-text";
import { LinkButton } from "@/components/link-button";
import { TextLink } from "@/components/text-link";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DataTableSkeleton } from "@/components/page-skeletons";
import { SectionBody, idrCompact } from "./clevel/parts";
import { FunnelChart, SourceChart } from "@/components/sales/pipeline-charts";
import { CountryMap } from "@/components/sales/country-map";
import { RangeSelect } from "@/components/sales/range-select";
import { ActiveClientsTable, MyInvoicesTable } from "./sales-tables";

/**
 * The Sales dashboard, laid out like the C-Level overview: the month's
 * billing in one strip, the trend (3, 6, 12 months or all time, in
 * `?range=`) beside what needs action, the pipeline (funnel, lead sources,
 * company countries), then your invoices and your clients as tables.
 */
export function SalesDashboard({ user, searchParams }: { user: CurrentUser; searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = dashboardContext(user);
  const range: ReportRange = REPORT_RANGES.find((r) => r.value === searchParams.range)?.value ?? DEFAULT_REPORT_RANGE;
  const firstName = user.fullName.split(" ")[0] || user.fullName;
  return (
    <div className="flex flex-col">
      <PageHeader
        title={`${greeting(timeIn(user.timezone))}, ${firstName}`}
        description={`${formatDateLong(ctx.today)} · ${roleLabel(user.role)}`}
        actions={<RefreshButton />}
        className="bleed mb-0"
      />
      <Suspense fallback={<SummarySkeleton />}>
        <SectionBody title="Sales summary" load={() => Promise.all([loadSalesSummary(ctx, range), loadDraftInvoices(ctx), loadUninvoicedProjects(ctx)])}>
          {([s, drafts, uninvoiced]) => <SummarySection s={s} range={range} drafts={drafts} uninvoiced={uninvoiced} />}
        </SectionBody>
      </Suspense>
      {perms.viewPipeline(user) && (
        <section aria-label="Pipeline" className="flex flex-col">
          <h2 className="bleed flex min-h-12 items-center justify-between border-b text-body font-medium">
            Pipeline
            <TextLink href="/sales/report" muted className="font-normal">
              Full report
            </TextLink>
          </h2>
          <Suspense fallback={<PipelineSkeleton />}>
            <SectionBody title="Pipeline" load={() => Promise.all([loadSalesInsights(user, ctx.monthStart, ctx.today), loadCompanyCountries(user)])}>
              {([insights, countries]) => <PipelineSection insights={insights} countries={countries} />}
            </SectionBody>
          </Suspense>
        </section>
      )}
      <TableSection title="My invoices" href="/invoices" cols={5}>
        <SectionBody title="My invoices" load={() => loadMyInvoices(ctx)}>
          {(rows) => <MyInvoicesTable rows={rows} />}
        </SectionBody>
      </TableSection>
      <TableSection title="Active clients" href="/clients" cols={3}>
        <SectionBody title="Active clients" load={() => loadActiveClients(ctx)}>
          {(rows) => <ActiveClientsTable rows={rows} canEdit={perms.editClients(user)} />}
        </SectionBody>
      </TableSection>
    </div>
  );
}

function TableSection({ title, href, cols, children }: { title: string; href: string; cols: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h2 className="bleed flex min-h-12 items-center justify-between border-b text-body font-medium">
        {title}
        <TextLink href={href} muted className="font-normal">
          View all
        </TextLink>
      </h2>
      <Suspense fallback={<DataTableSkeleton cols={cols} rows={5} />}>{children}</Suspense>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The month in one strip, the trend and what needs action
// ---------------------------------------------------------------------------

type Summary = Awaited<ReturnType<typeof loadSalesSummary>>;
type Drafts = Awaited<ReturnType<typeof loadDraftInvoices>>;
type Uninvoiced = Awaited<ReturnType<typeof loadUninvoicedProjects>>;

const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}T00:00:00Z`));

/** A compact IDR figure with the full value in its title; "—" when a rate is missing. */
function Idr({ value }: { value: number | null }) {
  return <span title={value === null ? "No exchange rate available" : formatMoney(value, "IDR")}>{idrCompact(value)}</span>;
}

/** "+IDR 82.8M (+13.9%)" vs last month, like the C-Level strip; nothing when either side couldn't be converted. */
function MonthDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return null;
  const change = current - previous;
  if (change === 0) return <span className="text-muted-foreground text-caption">Same as last month</span>;
  const up = change > 0;
  return (
    <span className={cn("tabular text-caption font-medium", up ? "text-success" : "text-destructive")} title={`vs last month (${formatMoney(previous, "IDR")})`}>
      {up ? "+" : "−"}
      {idrCompact(Math.abs(change))}
      {previous > 0 && ` (${up ? "+" : ""}${((change / previous) * 100).toFixed(1)}%)`}
      <span className="text-muted-foreground font-normal"> vs last month</span>
    </span>
  );
}

function SummarySection({ s, range, drafts, uninvoiced }: { s: Summary; range: ReportRange; drafts: Drafts; uninvoiced: Uninvoiced }) {
  const rateNote = s.rateDate ? `ECB reference rate, ${formatDate(s.rateDate)}` : "Exchange rates unavailable";
  return (
    <>
      <SummaryStrip
        variant="even"
        items={[
          { label: "Invoiced this month", values: [<Idr key="v" value={s.current.invoiced} />], delta: <MonthDelta current={s.current.invoiced} previous={s.previous.invoiced} /> },
          { label: "Collected this month", values: [<Idr key="v" value={s.current.collected} />], delta: <MonthDelta current={s.current.collected} previous={s.previous.collected} /> },
          {
            label: "Not yet invoiced",
            tone: s.uninvoiced ? "destructive" : "default",
            values: [`${s.uninvoiced} project${s.uninvoiced === 1 ? "" : "s"}`],
            delta: (
              <span className="text-muted-foreground text-caption">
                {s.drafts} draft{s.drafts === 1 ? "" : "s"} waiting to send
              </span>
            ),
          },
        ]}
      />
      <div className="bleed grid gap-4 border-b py-6 lg:h-[75vh] lg:grid-cols-[minmax(0,1fr)_380px]">
        <DashboardCard title="Collected vs invoiced" span="full" className="lg:col-span-1" action={<RangeSelect value={range} />}>
          <InOutChart
            data={s.trend.map((t) => ({ label: monthLabel(t.month), in: t.invoiced ?? 0, out: t.collected ?? 0 }))}
            layout="grouped"
            labels={{ in: "Invoiced", out: "Collected", gap: "Difference" }}
            height="fill"
            className="flex-1"
          />
          <p className="text-muted-foreground text-caption">
            {REPORT_RANGES.find((r) => r.value === range)!.label} in IDR · {rateNote}
          </p>
        </DashboardCard>
        <NeedsActionCard drafts={drafts} uninvoiced={uninvoiced} />
      </div>
    </>
  );
}

/** SL-1 + SL-4 — drafts you haven't sent, and running work with no invoice at all. */
function NeedsActionCard({ drafts, uninvoiced }: { drafts: Drafts; uninvoiced: Uninvoiced }) {
  const count = drafts.length + uninvoiced.length;
  return (
    <DashboardCard
      title="Needs action"
      span="full"
      className="lg:col-span-1"
      count={count}
      countTone="warning"
      isEmpty={count === 0}
      emptyText="No drafts to send, and every active project has an invoice."
      emptyIcon="success"
    >
      {/* The row has a fixed height; this list scrolls inside it rather than stretching the row. */}
      <div className="relative min-h-0 lg:flex-1">
        <div className="flex flex-col divide-y lg:absolute lg:-inset-x-2 lg:inset-y-0 lg:overflow-y-auto lg:px-2">
          {drafts.length > 0 && (
            <div className="flex flex-col gap-1 py-3 first:pt-0">
              <GroupTitle label="Drafts to send" count={drafts.length} />
              <CardList>
                {drafts.map((i) => (
                  <li key={i.id} className={cn(cardRowClass, "py-2")}>
                    <Link href={`/invoices/${i.id}`} className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{i.project}</span>
                      <span className="text-muted-foreground truncate text-caption">
                        {i.client} · <MoneyText value={i.total} currency={i.currency} />
                      </span>
                    </Link>
                    <LinkButton size="compact" variant="tertiary" className="shrink-0" icon={i.ready ? "send" : undefined} href={i.ready ? `/invoices/${i.id}?send=1` : `/invoices/${i.id}/edit`}>
                      {i.ready ? "Send" : "Continue"}
                    </LinkButton>
                  </li>
                ))}
              </CardList>
            </div>
          )}
          {uninvoiced.length > 0 && (
            <div className="flex flex-col gap-1 py-3 first:pt-0">
              <GroupTitle label="Projects without an invoice" count={uninvoiced.length} />
              <CardList>
                {uninvoiced.map((p) => (
                  <li key={p.id} className={cn(cardRowClass, "py-2")}>
                    <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">
                        <span className="text-muted-foreground tabular">{p.code}</span> {p.name}
                      </span>
                      <span className="text-muted-foreground truncate text-caption">
                        {p.client}
                        {p.contractType && <> · {humanizeEnum(p.contractType)}</>} · since {formatDateShort(p.startDate)}
                      </span>
                    </Link>
                    <LinkButton size="compact" variant="tertiary" className="shrink-0" icon="add" href={`/invoices/new?project=${p.id}`}>
                      Invoice
                    </LinkButton>
                  </li>
                ))}
              </CardList>
            </div>
          )}
        </div>
      </div>
    </DashboardCard>
  );
}

// ---------------------------------------------------------------------------
// The pipeline: funnel, lead sources and company countries (as in the report)
// ---------------------------------------------------------------------------

type Insights = Awaited<ReturnType<typeof loadSalesInsights>>;
type Countries = Awaited<ReturnType<typeof loadCompanyCountries>>;

function PipelineSection({ insights, countries }: { insights: Insights; countries: Countries }) {
  return (
    <div className="bleed grid gap-4 border-b py-6 lg:h-[75vh] lg:grid-cols-12">
      <DashboardCard title="Funnel" span="major" isEmpty={insights.leads === 0} emptyText="No leads yet." emptyIcon="target">
        <FunnelChart steps={insights.funnel} className="flex-1" />
        <p className="text-muted-foreground text-caption">
          {insights.leads} lead{insights.leads === 1 ? "" : "s"}, all time. A deal counts at every step it reached, even one it skipped.
        </p>
      </DashboardCard>
      <div className="flex flex-col gap-4 lg:col-span-3 lg:min-h-0">
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
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="bleed grid gap-4 border-b py-6 lg:h-[75vh] lg:grid-cols-12">
      <Skeleton className="h-[360px] rounded-xl lg:col-span-9 lg:h-auto" />
      <div className="flex flex-col gap-4 lg:col-span-3">
        <Skeleton className="h-[300px] rounded-xl lg:h-auto lg:flex-1" />
        <Skeleton className="h-[300px] rounded-xl lg:h-auto lg:flex-1" />
      </div>
    </div>
  );
}

/** A group heading inside "Needs action": the label in the body colour, its count in a gray badge. */
function GroupTitle({ label, count }: { label: string; count: number }) {
  return (
    <p className="flex items-center gap-2 text-body font-medium">
      {label}
      <Badge size="compact" color="gray" className="tabular">
        {count}
      </Badge>
    </p>
  );
}

function SummarySkeleton() {
  return (
    <>
      <div className="bleed flex border-b">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col gap-2 px-6 py-4 first:pl-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="bleed grid gap-4 border-b py-6 lg:h-[75vh] lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[340px] rounded-xl lg:h-auto" />
        <Skeleton className="h-[340px] rounded-xl lg:h-auto" />
      </div>
    </>
  );
}
