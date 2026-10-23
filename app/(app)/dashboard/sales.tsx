import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import {
  dashboardContext,
  loadActiveClients,
  loadDraftInvoices,
  loadMyInvoices,
  loadSalesSummary,
  loadUninvoicedProjects,
} from "@/lib/dashboard/queries";
import { greeting } from "@/lib/dashboard/pure";
import { formatDate, formatDateLong, formatDateShort, formatMoney, humanizeEnum } from "@/lib/format";
import { timeIn } from "@/lib/time/pure";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { CardGroupLabel, CardList, DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { InOutChart } from "@/components/in-out-chart";
import { MoneyText } from "@/components/money-text";
import { LinkButton } from "@/components/link-button";
import { TextLink } from "@/components/text-link";
import { Tooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/page-skeletons";
import { SectionBody, idrCompact } from "./clevel/parts";
import { ActiveClientsTable, MyInvoicesTable } from "./sales-tables";

/**
 * The Sales dashboard, laid out like the C-Level overview: the month's
 * billing in one strip, the trend beside what needs action, then your
 * invoices and your clients as tables.
 */
export function SalesDashboard({ user }: { user: CurrentUser }) {
  const ctx = dashboardContext(user);
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
        <SectionBody title="Sales summary" load={() => Promise.all([loadSalesSummary(ctx), loadDraftInvoices(ctx), loadUninvoicedProjects(ctx)])}>
          {([s, drafts, uninvoiced]) => <SummarySection s={s} drafts={drafts} uninvoiced={uninvoiced} />}
        </SectionBody>
      </Suspense>
      <TableSection title="My invoices" href="/invoices" cols={5}>
        <SectionBody title="My invoices" load={() => loadMyInvoices(ctx)}>
          {(rows) => <MyInvoicesTable rows={rows} />}
        </SectionBody>
      </TableSection>
      <TableSection title="Active clients" href="/clients" cols={5}>
        <SectionBody title="Active clients" load={() => loadActiveClients(ctx)}>
          {(rows) => <ActiveClientsTable rows={rows} />}
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

function SummarySection({ s, drafts, uninvoiced }: { s: Summary; drafts: Drafts; uninvoiced: Uninvoiced }) {
  const o = s.outstanding;
  const rateNote = s.rateDate ? `ECB reference rate, ${formatDate(s.rateDate)}` : "Exchange rates unavailable";
  return (
    <>
      <SummaryStrip
        variant="even"
        items={[
          { label: "Invoiced this month", values: [<Idr key="v" value={s.current.invoiced} />], delta: <MonthDelta current={s.current.invoiced} previous={s.previous.invoiced} /> },
          { label: "Collected this month", values: [<Idr key="v" value={s.current.collected} />], delta: <MonthDelta current={s.current.collected} previous={s.previous.collected} /> },
          {
            label: "Outstanding",
            values: [
              o.byCurrency.length > 0 ? (
                <Tooltip
                  key="v"
                  side="bottom"
                  className="px-2.5 py-2 [text-box:normal] supports-[text-box:trim-both]:py-2"
                  content={
                    <div className="flex flex-col gap-1">
                      {o.byCurrency.map((m) => (
                        <span key={m.currency} className="tabular">
                          {formatMoney(m.amount, m.currency)}
                        </span>
                      ))}
                      <span className="opacity-60">{rateNote}</span>
                    </div>
                  }
                >
                  <span tabIndex={0} className="cursor-default outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]">
                    {o.byCurrency.some((m) => m.currency !== "IDR") && "≈ "}
                    {idrCompact(o.idr)}
                  </span>
                </Tooltip>
              ) : (
                <span key="v">{idrCompact(0)}</span>
              ),
            ],
            delta: (
              <span className="text-muted-foreground text-caption">
                {o.invoices} open invoice{o.invoices === 1 ? "" : "s"}
                {o.late > 0 && <span className="text-destructive"> · {o.late} late</span>}
              </span>
            ),
          },
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
      <div className="bleed grid gap-4 border-b py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <DashboardCard title="Collected vs invoiced" span="full" className="lg:col-span-1">
          <InOutChart
            data={s.trend.map((t) => ({ label: monthLabel(t.month), in: t.invoiced ?? 0, out: t.collected ?? 0 }))}
            layout="grouped"
            labels={{ in: "Invoiced", out: "Collected", gap: "Difference" }}
            height={260}
          />
          <p className="text-muted-foreground text-caption">Last six months in IDR · {rateNote}</p>
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
      {drafts.length > 0 && (
        <div className="flex flex-col gap-1">
          <CardGroupLabel label="Drafts to send" count={drafts.length} />
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
        <div className="flex flex-col gap-1">
          <CardGroupLabel label="Projects without an invoice" count={uninvoiced.length} tone="warning" />
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
    </DashboardCard>
  );
}

function SummarySkeleton() {
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
        <Skeleton className="h-[340px] rounded-xl" />
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
    </>
  );
}
