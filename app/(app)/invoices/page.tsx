import { requireAccess, asUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { INVOICE_STATUSES, listInvoices, parseInvoiceFilters, summarize } from "@/lib/invoices/queries";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/pure";
import { CURRENCIES } from "@/lib/validation";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { SummaryStrip } from "@/components/summary-strip";
import { InvoicesTable } from "@/components/invoice/invoices-table";
import { PillButton } from "@/components/pill-button";
import { LinkButton } from "@/components/link-button";
import { EmptyState } from "@/components/states";
import { PeriodFilter } from "@/components/period-filter";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAccess(perms.viewInvoices);
  const sp = await searchParams;
  const filters = parseInvoiceFilters(sp);
  const [rows, clients] = await Promise.all([
    listInvoices(user, filters),
    asUser(user, (tx) => tx.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })),
  ]);
  const summary = summarize(rows);
  const canCreate = perms.editInvoices(user);
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Invoices"
        compact
        actions={
          <>
            <LinkButton variant="ghost" icon="csv" external href={`/api/invoices/export${qs ? `?${qs}` : ""}`}>
              Export CSV
            </LinkButton>
            {canCreate && <PillButton href="/invoices/new">New invoice</PillButton>}
          </>
        }
      />
      <SummaryStrip
        items={[
          { label: "Outstanding", values: summary.outstanding.map((o) => formatMoney(o.amount, o.currency)) },
          { label: "Overdue", values: [summary.overdue], tone: summary.overdue ? "destructive" : "default" },
        ]}
      />
      <FilterBar
        searchPlaceholder="Search number, client or project code"
        filters={[
          { param: "status", label: "Status", allLabel: "All statuses", options: INVOICE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] })) },
          { param: "client", label: "Client", allLabel: "All clients", options: clients.map((c) => ({ value: c.id, label: c.name })) },
          { param: "currency", label: "Currency", allLabel: "All currencies", options: CURRENCIES.map((c) => ({ value: c, label: c })) },
        ]}
        actions={<PeriodFilter from={filters.from} to={filters.to} label="Issue date period" placeholder="Any issue date" />}
      />
      {rows.length === 0 && !Object.keys(sp).length ? (
        <EmptyState
          icon="invoices"
          title="No invoices yet"
          description="Create an invoice from a client project. It's numbered ODAMA/YY/#### when first sent."
          action={canCreate ? <PillButton href="/invoices/new">New invoice</PillButton> : null}
        />
      ) : (
        <InvoicesTable rows={rows} />
      )}
    </div>
  );
}
