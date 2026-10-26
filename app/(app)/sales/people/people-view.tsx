"use client";

import type { CrmColumn, CrmFormOptions, PersonRow, Ref } from "@/lib/crm/queries";
import { RecordsTable, type BuiltinColumn } from "@/components/crm/records-table";
import { PillButton } from "@/components/pill-button";
import { NEW_RECORD } from "@/components/record-panel";
import { COUNTRY_REFS } from "@/components/country-select";
import { ClientPanel } from "@/components/clients/client-panel";
import { PersonPanel, useOpenPerson, useOpenPersonId } from "./person-panel";

/** People: contacts, with or without a company, and Sales' own columns. */
export function PeopleView({
  rows,
  columns,
  companies,
  owners,
  options,
  defaultCompanyId,
  canEdit,
}: {
  rows: PersonRow[];
  columns: CrmColumn[];
  companies: Ref[];
  owners: Ref[];
  options: CrmFormOptions;
  /** Set when People is narrowed to one company: a new person starts there. */
  defaultCompanyId?: string;
  canEdit: boolean;
}) {
  const openPerson = useOpenPerson();
  const openId = useOpenPersonId();
  const builtins: BuiltinColumn<PersonRow>[] = [
    { key: "email", header: "Email", icon: "mail", kind: "email", get: (r) => r.email },
    { key: "phone", header: "Phone", icon: "phone", kind: "phone", get: (r) => r.phone },
    { key: "jobTitle", header: "Job title", icon: "user", kind: "text", get: (r) => r.jobTitle },
    { key: "country", header: "Country", icon: "globe", kind: "ref", refs: COUNTRY_REFS, get: (r) => r.country },
    { key: "companyId", header: "Company", icon: "clients", kind: "ref", refs: companies, get: (r) => r.company?.id ?? null },
    { key: "ownerId", header: "Owner", icon: "user", kind: "ref", refs: owners, get: (r) => r.owner?.id ?? null },
  ];
  return (
    <>
      <RecordsTable
        object="person"
        noun="person"
        rows={rows}
        builtins={builtins}
        columns={columns}
        canEdit={canEdit}
        actions={canEdit && <PillButton onClick={() => openPerson(NEW_RECORD)}>New person</PillButton>}
        onOpen={(r) => openPerson(r.id)}
        openId={openId}
      />
      <PersonPanel rows={rows} companies={companies} owners={owners} options={options} defaultCompanyId={defaultCompanyId} canEdit={canEdit} />
      <ClientPanel scope="People" />
    </>
  );
}
