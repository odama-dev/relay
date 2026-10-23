"use client";

import type { CrmColumn, PersonRow, Ref } from "@/lib/crm/queries";
import { RecordsTable, type BuiltinColumn } from "@/components/crm/records-table";
import { NewRecordButton } from "../new-record";

/** People: contacts, with or without a company, and Sales' own columns. */
export function PeopleView({ rows, columns, companies, owners, canEdit }: { rows: PersonRow[]; columns: CrmColumn[]; companies: Ref[]; owners: Ref[]; canEdit: boolean }) {
  const builtins: BuiltinColumn<PersonRow>[] = [
    { key: "email", header: "Email", icon: "mail", kind: "email", get: (r) => r.email },
    { key: "phone", header: "Phone", icon: "phone", kind: "phone", get: (r) => r.phone },
    { key: "jobTitle", header: "Job title", icon: "user", kind: "text", get: (r) => r.jobTitle },
    { key: "companyId", header: "Company", icon: "clients", kind: "ref", refs: companies, get: (r) => r.company?.id ?? null },
    { key: "ownerId", header: "Owner", icon: "user", kind: "ref", refs: owners, get: (r) => r.owner?.id ?? null },
  ];
  return (
    <RecordsTable object="person" noun="person" rows={rows} builtins={builtins} columns={columns} canEdit={canEdit} actions={canEdit && <NewRecordButton object="person" companies={companies} />} />
  );
}
