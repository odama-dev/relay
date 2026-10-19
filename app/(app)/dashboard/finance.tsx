import Link from "next/link";
import { loadDueAndLate, loadIncomingPayments, loadOutstandingByClient, loadUnmatchedPayments } from "@/lib/dashboard/queries";
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

/** FN-4 — what each client still owes. */
export const OutstandingByClientCard = defineCard({ id: "FN-4", title: "Outstanding by client", span: "narrow" }, loadOutstandingByClient, (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} action={{ label: "Clients", href: "/clients" }} isEmpty={rows.length === 0} emptyText="No client owes anything." emptyIcon="clients">
    <CardList>
      {rows.slice(0, 8).map((c) => (
        <li key={c.id}>
          <Link href={`/clients/${c.id}?tab=invoices`} className={cn(cardRowClass, "items-start py-2")}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{c.name}</span>
              {c.late > 0 && <span className="text-destructive text-caption">{c.late} late</span>}
            </span>
            <MoneyList items={c.outstanding} className="shrink-0 items-end" />
          </Link>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));
