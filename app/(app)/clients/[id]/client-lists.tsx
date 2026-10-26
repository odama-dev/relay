"use client";

import type { ClientDetail } from "@/lib/clients/queries";
import type { ClientSalesView } from "@/lib/crm/queries";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { formatDate, sentenceEnum } from "@/lib/format";

type ProjectRow = ClientDetail["projects"][number];
type InvoiceRow = ClientDetail["invoices"][number];

export function ClientProjects({ projects }: { projects: ProjectRow[] }) {
  const columns: Column<ProjectRow>[] = [
    {
      id: "project",
      header: "Project",
      primary: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <span className="flex items-center gap-2">
          <StatusDot value={r.status} />
          {r.name}
        </span>
      ),
    },
    { id: "code", header: "Code", sortValue: (r) => r.code, cell: (r) => <span className="tabular">{r.code}</span> },
    { id: "pm", header: "PM", sortValue: (r) => r.pm, cell: (r) => r.pm },
    {
      id: "contract",
      header: "Contract",
      cell: (r) => r.contractType === "time_and_material" ? "Time & material" : sentenceEnum(r.contractType ?? ""),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={projects}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/projects/${r.id}`}
      emptyTitle="No projects you can see"
      emptyDescription="Projects for this client appear here."
    />
  );
}

export function ClientInvoices({ invoices }: { invoices: InvoiceRow[] }) {
  const columns: Column<InvoiceRow>[] = [
    { id: "number", header: "Number", sortValue: (r) => r.number ?? "", cell: (r) => r.number ?? "Draft" },
    { id: "project", header: "Project", primary: true, sortValue: (r) => r.projectCode, cell: (r) => <span className="tabular">{r.projectCode}</span> },
    { id: "issued", header: "Issued", sortValue: (r) => r.issueDate, cell: (r) => formatDate(r.issueDate) },
    { id: "total", header: "Total", align: "right", sortValue: (r) => r.total, cell: (r) => <MoneyText value={r.total} currency={r.currency} /> },
    { id: "paid", header: "Paid", align: "right", sortValue: (r) => r.amountPaid, cell: (r) => <MoneyText value={r.amountPaid} currency={r.currency} /> },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <StatusBadge value={r.status} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={invoices}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/invoices/${r.id}`}
      emptyTitle="No invoices yet"
      emptyDescription="Invoices are created from a client project."
    />
  );
}

type DealRow = ClientSalesView["deals"][number];
type PersonRow = ClientSalesView["people"][number];

/** The client's deals (Sales view); a row opens the deal on the pipeline. */
export function ClientDeals({ deals }: { deals: DealRow[] }) {
  const columns: Column<DealRow>[] = [
    { id: "title", header: "Lead", primary: true, sortValue: (r) => r.title.toLowerCase(), cell: (r) => r.title },
    { id: "stage", header: "Stage", sortValue: (r) => r.stage, cell: (r) => <StatusBadge value={r.category} label={r.stage} /> },
    { id: "owner", header: "Owner", sortValue: (r) => r.owner?.name ?? "", cell: (r) => r.owner?.name ?? "—" },
    { id: "person", header: "Person", sortValue: (r) => r.person?.name ?? "", cell: (r) => r.person?.name ?? "—" },
    { id: "value", header: "Value", align: "right", sortValue: (r) => r.value, cell: (r) => <MoneyText value={r.value} currency={r.currency} /> },
    { id: "lead", header: "Lead in", sortValue: (r) => r.leadDate, cell: (r) => <span className="tabular">{formatDate(r.leadDate)}</span> },
    { id: "contact", header: "Last contact", sortValue: (r) => r.lastContactOn ?? "", cell: (r) => <span className="tabular">{r.lastContactOn ? formatDate(r.lastContactOn) : "—"}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={deals}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/sales?deal=${r.id}`}
      emptyTitle="No deals yet"
      emptyDescription="Deals linked to this client or its company show here."
    />
  );
}

/** People at the client's company or on its deals (Sales view). */
export function ClientPeople({ people }: { people: PersonRow[] }) {
  const columns: Column<PersonRow>[] = [
    { id: "name", header: "Name", primary: true, sortValue: (r) => r.name.toLowerCase(), cell: (r) => r.name },
    { id: "title", header: "Job title", sortValue: (r) => r.jobTitle ?? "", cell: (r) => r.jobTitle ?? "—" },
    { id: "email", header: "Email", sortValue: (r) => r.email ?? "", cell: (r) => r.email ?? "—" },
  ];
  return (
    <DataTable
      columns={columns}
      rows={people}
      getRowId={(r) => r.id}
      emptyTitle="No people yet"
      emptyDescription="Add people at this company in Sales → People."
    />
  );
}
