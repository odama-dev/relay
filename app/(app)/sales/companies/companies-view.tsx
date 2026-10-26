"use client";

import Link from "next/link";
import type { CompanyRow, CrmColumn, CrmFormOptions, Ref } from "@/lib/crm/queries";
import { RecordsTable, type BuiltinColumn } from "@/components/crm/records-table";
import { PillButton } from "@/components/pill-button";
import { NEW_RECORD } from "@/components/record-panel";
import { COUNTRY_REFS } from "@/components/country-select";
import { ClientPanel, useOpenClient } from "@/components/clients/client-panel";
import { CompanyPanel, useOpenCompany, useOpenCompanyId } from "./company-panel";

/** Companies: built-in fields, then Sales' own columns. A row opens the company panel. */
export function CompaniesView({
  rows,
  columns,
  owners,
  options,
  canEdit,
}: {
  rows: CompanyRow[];
  columns: CrmColumn[];
  owners: Ref[];
  options: CrmFormOptions;
  canEdit: boolean;
}) {
  const openClient = useOpenClient();
  const openCompany = useOpenCompany();
  const openId = useOpenCompanyId();
  const builtins: BuiltinColumn<CompanyRow>[] = [
    { key: "domain", header: "Domain", icon: "globe", kind: "text", get: (r) => r.domain },
    { key: "country", header: "Country", icon: "globe", kind: "ref", refs: COUNTRY_REFS, get: (r) => r.country },
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
      <RecordsTable
        object="company"
        noun="company"
        rows={rows}
        builtins={builtins}
        columns={columns}
        canEdit={canEdit}
        actions={canEdit && <PillButton onClick={() => openCompany(NEW_RECORD)}>New company</PillButton>}
        onOpen={(r) => openCompany(r.id)}
        openId={openId}
      />
      <CompanyPanel rows={rows} owners={owners} options={options} canEdit={canEdit} />
      <ClientPanel ids={clientIds} scope="Companies" />
    </>
  );
}
