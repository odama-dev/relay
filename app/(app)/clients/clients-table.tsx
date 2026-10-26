"use client";

import type { ClientRow } from "@/lib/clients/queries";
import { DataTable, type Column } from "@/components/data-table";
import { PillButton } from "@/components/pill-button";
import { NEW_RECORD } from "@/components/record-panel";
import { ClientPanel, useOpenClient, useOpenClientId } from "@/components/clients/client-panel";

/** Opens the client panel on a blank client (`?client=new`). */
export function AddClientButton() {
  const openClient = useOpenClient();
  return <PillButton onClick={() => openClient(NEW_RECORD)}>Add client</PillButton>;
}

/** Clients; a row opens the client as a side panel over the list (a new client opens there too). */
export function ClientsTable({ rows, canCreate }: { rows: ClientRow[]; canCreate: boolean }) {
  const openClient = useOpenClient();
  const openId = useOpenClientId();
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
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowClick={(r) => openClient(r.id)}
        isRowSelected={(r) => r.id === openId}
        emptyTitle="No clients match"
        emptyDescription="Try another search."
      />
      <ClientPanel ids={rows.map((r) => r.id)} canCreate={canCreate} />
    </>
  );
}
