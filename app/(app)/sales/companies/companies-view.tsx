"use client";

import Link from "next/link";
import type { CompanyRow, CrmColumn, Ref } from "@/lib/crm/queries";
import { RecordsTable, type BuiltinColumn } from "@/components/crm/records-table";
import { NewRecordButton } from "../new-record";
import { ClientPanel, useOpenClient } from "@/components/clients/client-panel";

/** Companies: built-in fields, then Sales' own columns. */
export function CompaniesView({ rows, columns, owners, canEdit }: { rows: CompanyRow[]; columns: CrmColumn[]; owners: Ref[]; canEdit: boolean }) {
  const openClient = useOpenClient();
  const builtins: BuiltinColumn<CompanyRow>[] = [
    { key: "domain", header: "Domain", icon: "globe", kind: "text", get: (r) => r.domain },
    { key: "description", header: "Description", icon: "text", kind: "longtext", get: (r) => r.description },
    {
      key: "people",
      header: "People",
      icon: "people",
      kind: "number",
      get: (r) => r.people,
      render: (r) =>
        r.people ? (
          <Link href={`/sales/people?company=${r.id}`} className="tabular block text-right hover:underline">
            {r.people}
          </Link>
        ) : (
          <span className="text-muted-foreground block text-right">—</span>
        ),
    },
    {
      key: "client",
      header: "Client",
      icon: "clients",
      kind: "text",
      get: (r) => r.client?.name ?? null,
      // A client opens as a side panel: deals, people, notes and email.
      render: (r) =>
        r.client ? (
          <button type="button" onClick={() => openClient(r.client!.id)} className="truncate text-left hover:underline">
            {r.client.name}
          </button>
        ) : (
          <span className="text-muted-foreground">Prospect</span>
        ),
    },
    { key: "ownerId", header: "Owner", icon: "user", kind: "ref", refs: owners, get: (r) => r.owner?.id ?? null },
  ];
  const clientIds = rows.flatMap((r) => (r.client ? [r.client.id] : []));
  return (
    <>
      <RecordsTable object="company" noun="company" rows={rows} builtins={builtins} columns={columns} canEdit={canEdit} actions={canEdit && <NewRecordButton object="company" />} />
      <ClientPanel ids={clientIds} scope="Companies" />
    </>
  );
}
