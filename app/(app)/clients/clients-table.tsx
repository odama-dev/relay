"use client";

import type { ClientRow } from "@/lib/clients/queries";
import { DataTable, type Column } from "@/components/data-table";

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const columns: Column<ClientRow>[] = [
    { id: "client", header: "Client", primary: true, sortValue: (r) => r.name.toLowerCase(), cell: (r) => r.name },
    { id: "code", header: "Code", sortValue: (r) => r.code, cell: (r) => <span className="tabular">{r.code}</span> },
    { id: "contact", header: "Primary contact", sortValue: (r) => r.primaryContact ?? "", cell: (r) => r.primaryContact ?? "—" },
    { id: "country", header: "Country", sortValue: (r) => r.country ?? "", cell: (r) => r.country ?? "—" },
    { id: "currency", header: "Currency", sortValue: (r) => r.defaultCurrency, cell: (r) => r.defaultCurrency },
    {
      id: "projects",
      header: "Projects",
      align: "right",
      sortValue: (r) => r.activeProjects,
      cell: (r) => (
        <span>
          {r.activeProjects}
          <span> / {r.totalProjects}</span>
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/clients/${r.id}`}
      emptyTitle="No clients match"
      emptyDescription="Try another search."
    />
  );
}
