import Link from "next/link";
import { loadActiveClients, loadDraftInvoices, loadMyInvoices, loadUninvoicedProjects, type MyInvoice } from "@/lib/dashboard/queries";
import { formatDate, formatDateShort, humanizeEnum } from "@/lib/format";
import { CardList, DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { MoneyText } from "@/components/money-text";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/link-button";
import { Icon, type IconName } from "@/components/icon";
import { cn } from "@/lib/utils";
import { defineCard, MoneyList } from "./card";

/** SL-1 — invoices you haven't sent yet. */
export const DraftInvoicesCard = defineCard({ id: "SL-1", title: "Draft invoices", span: "wide" }, loadDraftInvoices, (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} action={{ label: "Invoices", href: "/invoices?status=draft" }} isEmpty={rows.length === 0} emptyText="No draft invoices." emptyIcon="invoices">
    <CardList>
      {rows.map((i) => (
        <li key={i.id} className={cn(cardRowClass, "py-2")}>
          <Link href={`/invoices/${i.id}`} className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{i.project}</span>
            <span className="text-muted-foreground truncate text-caption">
              {i.client} · created {formatDate(i.createdAt)}
            </span>
          </Link>
          <MoneyText value={i.total} currency={i.currency} className="hidden shrink-0 sm:inline" />
          <span className="flex shrink-0 gap-1">
            <LinkButton size="compact" variant="ghost" href={`/invoices/${i.id}/edit`}>
              Continue
            </LinkButton>
            {i.ready && (
              <LinkButton size="compact" variant="tertiary" icon="send" href={`/invoices/${i.id}?send=1`}>
                Send
              </LinkButton>
            )}
          </span>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

const REQUEST_ICON: Record<MyInvoice["requests"][number]["status"], { icon: IconName; className: string; label: string }> = {
  paid: { icon: "success", className: "text-success", label: "Paid" },
  pending: { icon: "time", className: "text-muted-foreground", label: "Pending" },
  late: { icon: "warning", className: "text-destructive", label: "Late" },
  expired: { icon: "warning", className: "text-warning", label: "Link expired" },
  void: { icon: "error", className: "text-muted-foreground", label: "Void" },
};

/** SL-2 — what's been paid, and what's late, on the invoices you created. */
export const MyInvoicesCard = defineCard({ id: "SL-2", title: "My invoices", span: "narrow" }, loadMyInvoices, (rows, _ctx, meta) => {
  const late = rows.filter((r) => r.status === "overdue").length;
  return (
    <DashboardCard
      {...meta}
      count={rows.length}
      countTone={late ? "critical" : "neutral"}
      action={{ label: "Invoices", href: "/invoices" }}
      isEmpty={rows.length === 0}
      emptyText="No open invoices, and none paid in the last 30 days."
      emptyIcon="invoices"
    >
      <CardList>
        {rows.slice(0, 8).map((i) => (
          <li key={i.id} className={cn(cardRowClass, "items-start py-2")}>
            <Link href={`/invoices/${i.id}`} className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="tabular truncate">{i.number ?? "Draft"}</span>
                <span className="flex shrink-0 items-center gap-0.5">
                  {i.requests.map((r, n) => {
                    const s = REQUEST_ICON[r.status];
                    return (
                      <span key={n} title={`${r.label} · ${s.label} · due ${formatDateShort(r.dueDate)}`} className={s.className}>
                        <Icon name={s.icon} size={13} />
                        <span className="sr-only">
                          {r.label}: {s.label}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </span>
              <span className="text-muted-foreground truncate text-caption">{i.client}</span>
            </Link>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge value={i.status} />
              {i.remaining > 0 && <MoneyText value={i.remaining} currency={i.currency} className="text-caption" />}
            </span>
          </li>
        ))}
      </CardList>
    </DashboardCard>
  );
});

/** SL-3 — how your clients are doing: projects, worst health, outstanding, anything late. */
export const ActiveClientsCard = defineCard({ id: "SL-3", title: "Active clients", span: "wide" }, loadActiveClients, (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} action={{ label: "Clients", href: "/clients" }} isEmpty={rows.length === 0} emptyText="No clients with active projects." emptyIcon="clients">
    <CardList>
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/clients/${c.id}`} className={cn(cardRowClass, "items-start py-2")}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{c.name}</span>
              <span className="text-muted-foreground truncate text-caption">
                {c.projects} active project{c.projects === 1 ? "" : "s"}
                {c.late && <span className="text-destructive"> · payment late</span>}
              </span>
            </span>
            <MoneyList items={c.outstanding} className="hidden shrink-0 items-end sm:flex" empty="Nothing owed" />
            <StatusBadge value={c.health} className="shrink-0" />
          </Link>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

/** SL-4 — work that's running but hasn't been billed. */
export const UninvoicedProjectsCard = defineCard({ id: "SL-4", title: "Projects without an invoice", span: "narrow" }, loadUninvoicedProjects, (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} countTone="warning" isEmpty={rows.length === 0} emptyText="Every active client project has an invoice." emptyIcon="success">
    <CardList>
      {rows.map((p) => (
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
  </DashboardCard>
));
