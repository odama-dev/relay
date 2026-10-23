import { requireAccess, asUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { INVOICE_STATUSES, listInvoices, parseInvoiceFilters, summarize } from "@/lib/invoices/queries";
import { INVOICE_STATUS_LABELS, normalizeToIdr } from "@/lib/invoices/pure";
import { getIdrRates } from "@/lib/fx";
import { CURRENCIES } from "@/lib/validation";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { SummaryStrip } from "@/components/summary-strip";
import { InvoicesTable } from "@/components/invoice/invoices-table";
import { OutstandingTotal } from "@/components/invoice/outstanding-total";
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
  const rates = await getIdrRates([...summary.billed, ...summary.outstanding].map((o) => o.currency));
  const outstandingIdr = rates ? normalizeToIdr(summary.outstanding, rates.toIdr) : null;
  // Other totals in IDR at the same indicative rates; per currency when a rate is missing.
  const idr = (list: { currency: string; amount: number }[]) => {
    if (!list.length) return [];
    const v = rates ? normalizeToIdr(list, rates.toIdr) : null;
    const approx = list.some((m) => m.currency !== "IDR");
    return v === null ? list.map((m) => formatMoney(m.amount, m.currency)) : [`${approx ? "≈ " : ""}${formatMoney(v, "IDR", { compact: true })}`];
  };
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
          { label: "Sent", values: [summary.sent] },
          {
            label: "Unpaid",
            values: summary.outstanding.length
              ? [<OutstandingTotal key="o" outstanding={summary.outstanding} idr={outstandingIdr} rateDate={rates?.date ?? ""} toIdr={rates?.toIdr ?? {}} />]
              : [],
          },
          {
            label: "Overdue",
            values: summary.overdue ? idr(summary.overdueAmounts) : [0],
            tone: summary.overdue ? "destructive" : "default",
          },
          { label: "Waiting verification", values: [summary.submitted] },
          { label: "Collected", values: idr(summary.collected) },
          { label: "Drafts", values: [summary.drafts] },
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
