import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { ObligationKind } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth";
import { hasModule, roleLabel } from "@/lib/roles";
import { greeting } from "@/lib/dashboard/pure";
import { addDays, timeIn } from "@/lib/time/pure";
import { sundayOf } from "@/lib/hr/pure";
import { lastDayOfMonth } from "@/lib/clevel/pure";
import { formatDateLong, formatDateShort, formatMoney } from "@/lib/format";
import { listObligations, loadAgingByClient, loadFinanceStrip, loadObligations, obligationMonth } from "@/lib/finance/ops";
import { dashboardContext } from "@/lib/dashboard/queries";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { SummaryStrip } from "@/components/summary-strip";
import { DashboardGrid } from "@/components/dashboard-card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/page-skeletons";
import { AgingByClientTable } from "@/components/finance/aging-table";
import { ObligationsCalendar } from "@/components/finance/obligations-calendar";
import { SectionBody } from "./clevel/parts";
import { ProofQueueCard } from "./phase2-cards";
import { loadDueAndLate, loadIncomingPayments, loadUnmatchedPayments } from "@/lib/dashboard/queries";
import { formatDateTime } from "@/lib/format";
import { CardFigure, CardGroupLabel, CardList, DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";
import { MatchPaymentButton } from "@/app/(app)/payments/match-payment";
import { cn } from "@/lib/utils";
import { defineCard, MoneyList, RequestRow } from "./card";

/** FN-1 — payments to match by hand. */
export const UnmatchedPaymentsCard = defineCard({ id: "FN-1", title: "Payments to match", span: "wide" }, loadUnmatchedPayments, (d, ctx, meta) => (
  <DashboardCard
    {...meta}
    count={d.rows.length}
    countTone="warning"
    action={{ label: "Payments", href: "/payments?tab=unmatched" }}
    isEmpty={d.rows.length === 0}
    emptyText="Every payment is matched."
    emptyIcon="payments"
  >
    <CardList>
      {d.rows.slice(0, 8).map((p) => (
        <li key={p.id} className={cn(cardRowClass, "py-2")}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">
              <MoneyText value={p.amount} currency={p.currency} className="font-medium" />
              {p.idr != null && p.currency !== "IDR" && (
                <span className="text-muted-foreground">
                  {" "}
                  · <MoneyText value={p.idr} currency="IDR" />
                </span>
              )}
            </span>
            <span className="text-muted-foreground truncate text-caption">
              {p.externalId} · {formatDateTime(p.paidAt, ctx.user.timezone)}
              {p.channel && <> · {p.channel}</>}
            </span>
          </span>
          {p.unmatched ? (
            <MatchPaymentButton paymentId={p.id} options={d.options} />
          ) : (
            <Link href="/payments?tab=review" className="shrink-0">
              <StatusBadge value="pending" label="Needs review" />
            </Link>
          )}
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

/** FN-2 — money in today and this week (IDR received). */
export const IncomingPaymentsCard = defineCard({ id: "FN-2", title: "Payments received", span: "narrow" }, loadIncomingPayments, (d, _ctx, meta) => (
  <DashboardCard {...meta} action={{ label: "All payments", href: "/payments?tab=all" }}>
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <CardFigure label="Today" value={<MoneyText value={d.today} currency="IDR" />} hint={`${d.todayCount} payment${d.todayCount === 1 ? "" : "s"}`} />
        <CardFigure label="This week" value={<MoneyText value={d.week} currency="IDR" />} hint={`${d.weekCount} payment${d.weekCount === 1 ? "" : "s"}`} />
      </div>
      {d.latest.length === 0 ? (
        <p className="text-muted-foreground text-body">No payments received this week.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <CardGroupLabel label="Latest" />
          <CardList>
            {d.latest.map((p) => (
              <li key={p.id}>
                <Link href={p.invoice ? `/invoices/${p.invoice.id}` : "/payments"} className={cn(cardRowClass, "items-start py-2")}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{p.client}</span>
                    <span className="text-muted-foreground truncate text-caption">
                      {p.invoice?.number}
                      {p.label && <> · {p.label}</>}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <MoneyText value={p.amount} currency={p.currency} />
                    <span className="text-muted-foreground text-caption">
                      {p.idr != null && p.currency !== "IDR" && <MoneyText value={p.idr} currency="IDR" />}
                      {p.fee != null && p.fee > 0 && (
                        <>
                          {p.idr != null && p.currency !== "IDR" && " · "}
                          fee <MoneyText value={p.fee} currency={p.currency} />
                        </>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </CardList>
        </div>
      )}
    </div>
  </DashboardCard>
));

/** FN-3 — due within 7 days, and late — across every project. */
export const DueAndLateCard = defineCard({ id: "FN-3", title: "Due & late", span: "wide" }, loadDueAndLate, (d, _ctx, meta) => {
  const total = d.late.length + d.soon.length;
  return (
    <DashboardCard
      {...meta}
      count={total}
      countTone={d.late.length ? "critical" : "neutral"}
      action={{ label: "Overdue invoices", href: "/invoices?status=overdue" }}
      isEmpty={total === 0}
      emptyText="Nothing due in the next 7 days."
      emptyIcon="invoices"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { label: "Late", tone: "critical" as const, rows: d.late, totals: d.lateTotals },
          { label: "Due within 7 days", tone: undefined, rows: d.soon, totals: d.soonTotals },
        ].map((g) => (
          <div key={g.label} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <CardGroupLabel label={g.label} count={g.rows.length} tone={g.tone} />
              <MoneyList items={g.totals} className="items-end text-caption" empty="" />
            </div>
            {g.rows.length === 0 ? (
              <p className="text-muted-foreground py-1 text-body">None.</p>
            ) : (
              <CardList>{g.rows.slice(0, 6).map((r) => <RequestRow key={r.id} r={r} showCreator />)}</CardList>
            )}
          </div>
        ))}
      </div>
    </DashboardCard>
  );
});

/** Kinds this person keeps (RLS: app.can_manage_obligation). */
export function manageableKinds(user: CurrentUser): ObligationKind[] {
  if (hasModule(user, "finance")) return ["payroll", "bpjs", "tax", "other"];
  return hasModule(user, "people") ? ["payroll", "bpjs"] : [];
}

/**
 * The Finance dashboard (PRD Phase 2 "Finance", M10): operational — what has
 * to be done today. The strip, the queues (proofs to verify, payments to
 * match, due & late), receivables per client, then the obligations calendar.
 * Trends and margins stay on the C-Level dashboard and Finance Overview.
 */
export function FinanceDashboard({ user, searchParams }: { user: CurrentUser; searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = dashboardContext(user);
  const firstName = user.fullName.split(" ")[0] || user.fullName;
  const month = obligationMonth(typeof searchParams.omonth === "string" ? searchParams.omonth : undefined, ctx.today);
  return (
    <div className="flex flex-col">
      <PageHeader
        title={`${greeting(timeIn(user.timezone))}, ${firstName}`}
        description={`${formatDateLong(ctx.today)} · ${roleLabel(user.role)}`}
        actions={<RefreshButton />}
        className="bleed mb-0"
      />
      <Suspense fallback={<Skeleton className="bleed h-[92px] rounded-none border-b" />}>
        <SectionBody title="Finance summary" load={() => loadFinanceStrip(user)}>
          {(s) => (
            <SummaryStrip
              variant="even"
              items={[
                { label: "Cash in this month", values: [<span key="v" title={formatMoney(s.cashIn, "IDR")}>{formatMoney(s.cashIn, "IDR", { compact: true })}</span>], delta: <Caption>Payments received, settled IDR</Caption> },
                {
                  label: "Receivables due this week",
                  values: [<span key="v" title={formatMoney(s.dueThisWeek.idr, "IDR")}>{formatMoney(s.dueThisWeek.idr, "IDR", { compact: true })}</span>],
                  delta: (
                    <Caption>
                      {s.dueThisWeek.count} request{s.dueThisWeek.count === 1 ? "" : "s"} · {formatDateShort(s.dueThisWeek.from)}–{formatDateShort(s.dueThisWeek.to)}
                      {s.dueThisWeek.missing > 0 && ` · ${s.dueThisWeek.missing} without a rate`}
                    </Caption>
                  ),
                },
                {
                  label: "Proofs to verify",
                  tone: s.proofs.oldestDays !== null && s.proofs.oldestDays >= 2 ? "destructive" : "default",
                  values: [<Link key="v" href="/payments?tab=verify" className="hover:underline">{s.proofs.count}</Link>],
                  delta: <Caption>{s.proofs.oldestDays === null ? "Nothing waiting" : `Oldest ${s.proofs.oldestDays} day${s.proofs.oldestDays === 1 ? "" : "s"} · target 2 working days`}</Caption>,
                },
                ...(s.expenses
                  ? [{ label: "Expenses this month", values: [<span key="v" title={formatMoney(s.expenses.idr, "IDR")}>{formatMoney(s.expenses.idr, "IDR", { compact: true })}</span>], delta: <Caption>Recorded so far</Caption> }]
                  : []),
              ]}
            />
          )}
        </SectionBody>
      </Suspense>
      <div className="py-6">
        <DashboardGrid>
          <ProofQueueCard ctx={ctx} />
          <DueAndLateCard ctx={ctx} />
          <UnmatchedPaymentsCard ctx={ctx} />
          <IncomingPaymentsCard ctx={ctx} />
        </DashboardGrid>
      </div>
      <Section title="Receivables by client" href="/invoices?status=overdue" link="Overdue invoices">
        <Suspense fallback={<DataTableSkeleton cols={6} rows={5} />}>
          <SectionBody title="Receivables by client" load={() => loadAgingByClient(user)}>
            {(rows) => <AgingByClientTable rows={rows} />}
          </SectionBody>
        </Suspense>
      </Section>
      <div className="bleed border-b">
        <Suspense fallback={<Skeleton className="h-[560px] rounded-none" />}>
          <SectionBody title="Obligations" load={() => Promise.all([loadObligations(user, sundayOf(month), addDays(sundayOf(lastDayOfMonth(month)), 6)), listObligations(user)])}>
            {([items, obligations]) => <ObligationsCalendar month={month} today={ctx.today} items={items} obligations={obligations} manageable={manageableKinds(user)} />}
          </SectionBody>
        </Suspense>
      </div>
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-caption">{children}</span>;
}

function Section({ title, href, link, children }: { title: string; href: string; link: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h2 className="bleed flex min-h-12 items-center justify-between border-y text-body font-medium">
        {title}
        <Link href={href} className="text-muted-foreground hover:text-foreground text-body font-normal">
          {link}
        </Link>
      </h2>
      {children}
    </section>
  );
}
