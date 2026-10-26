"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CrmFormOptions, PersonRow, Ref } from "@/lib/crm/queries";
import type { PersonRecord } from "@/lib/crm/person-record";
import { CONNECTION_LABELS, type ConnectionStrength, type CrmValue } from "@/lib/crm/pure";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { COUNTRY_REFS } from "@/components/country-select";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { MoneyText } from "@/components/money-text";
import { DetailList } from "@/components/detail-list";
import { NotesPanel } from "@/components/crm/notes-panel";
import { EditableCell, type CellKind } from "@/components/crm/cells";
import { MailActivity } from "@/components/mail/mail-activity";
import { useOpenClient } from "@/components/clients/client-panel";
import {
  ActivityList,
  Highlight,
  HighlightEmpty,
  NEW_RECORD,
  PanelSection,
  RecordBody,
  RecordPanel,
  useOpenRecord,
  useOpenRecordId,
  useRecordEditing,
  type ActivityItem,
  type RecordTab,
} from "@/components/record-panel";
import { loadPersonRecord, setField } from "../crm-actions";
import { PersonForm } from "./person-form";

const PARAM = "person";

/** Opens the person panel on People (`?person=<id>`; `?person=new` for a new person). */
export const useOpenPerson = () => useOpenRecord(PARAM);
export const useOpenPersonId = () => useOpenRecordId(PARAM);

const STRENGTH_DOT: Record<ConnectionStrength, string> = {
  very_strong: "bg-chart-in",
  strong: "bg-chart-in/60",
  weak: "bg-foreground/30",
  none: "bg-foreground/10",
};

/**
 * A person as a side panel over People: connection strength from email,
 * company, email and phone, their deals, notes and mail. Fields edit in
 * place, like the table. A new person and a person's edit form open in the
 * same panel (`?person=new`, `&edit=1`).
 */
export function PersonPanel({
  rows,
  companies,
  owners,
  options,
  defaultCompanyId,
  canEdit,
}: {
  rows: PersonRow[];
  companies: Ref[];
  owners: Ref[];
  options: CrmFormOptions;
  defaultCompanyId?: string;
  canEdit: boolean;
}) {
  const personId = useOpenPersonId();
  const open = useOpenPerson();
  const editing = useRecordEditing();
  const isNew = personId === NEW_RECORD;
  const queryClient = useQueryClient();
  const row = rows.find((r) => r.id === personId) ?? null;
  const { data, isLoading, isError } = useQuery<PersonRecord>({
    // The company is part of the key: moving them to another company refetches the panel.
    queryKey: ["person-record", personId, row?.company?.id ?? null],
    queryFn: () => loadPersonRecord(personId),
    enabled: Boolean(personId) && !isNew,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const ready = Boolean(row && data && data.id === row.id);
  const form = canEdit && (isNew || (editing && row));
  const reload = () => void queryClient.invalidateQueries({ queryKey: ["person-record", personId] });

  return (
    <RecordPanel
      param={PARAM}
      ids={rows.map((r) => r.id)}
      scope="People"
      noun="person"
      storageKey="person-panel-width"
      title={isNew ? "New person" : row?.name}
      isLoading={!form && (isLoading || Boolean(personId)) && !ready && !isError}
      error={!form && isError ? { title: "Couldn't load this person", description: "They may have been archived, or you can't see Sales." } : null}
    >
      {form ? (
        <PersonForm
          key={row?.id ?? NEW_RECORD}
          person={row ?? undefined}
          options={options}
          defaultCompanyId={defaultCompanyId}
          onSaved={(id) => {
            open(id);
            reload();
          }}
          onCancel={() => open(row?.id ?? null)}
        />
      ) : (
        ready &&
        row &&
        data && (
          <PersonRecordView
            key={row.id}
            row={row}
            record={data}
            companies={companies}
            owners={owners}
            canEdit={canEdit}
            onEdit={() => open(row.id, { edit: true })}
            onChanged={reload}
          />
        )
      )}
    </RecordPanel>
  );
}

function PersonRecordView({
  row,
  record,
  companies,
  owners,
  canEdit,
  onEdit,
  onChanged,
}: {
  row: PersonRow;
  record: PersonRecord;
  companies: Ref[];
  owners: Ref[];
  canEdit: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", content: <Overview row={row} record={record} companies={companies} owners={owners} canEdit={canEdit} onShow={setTab} /> },
    {
      value: "notes",
      label: "Notes",
      count: record.notes.length,
      content: <NotesPanel target={{ personId: row.id }} notes={record.notes} canWrite={record.viewer.canWriteNotes} timeZone={record.viewer.timeZone} onChanged={onChanged} />,
    },
    {
      value: "email",
      label: "Emails",
      count: record.mail.length,
      content: (
        <MailActivity
          messages={record.mail}
          timeZone={record.viewer.timeZone}
          emptyTitle="No email yet"
          emptyDescription={row.email ? "Mail with this person shows here once a mailbox is connected in Mail." : "Add their email address to match your mail to them."}
        />
      ),
    },
    { value: "deals", label: "Deals", count: record.deals.length, content: <PersonDeals deals={record.deals} /> },
  ];
  return (
    <RecordBody
      icon="user"
      title={row.name}
      meta={<span className="truncate">{[row.jobTitle, row.company?.name].filter(Boolean).join(" · ") || "No company"}</span>}
      actions={
        canEdit && (
          <Button type="button" variant="tertiary" size="sm" onClick={onEdit}>
            Edit person
          </Button>
        )
      }
      tabs={tabs}
      tab={tab}
      onTab={setTab}
    />
  );
}

function Overview({
  row,
  record,
  companies,
  owners,
  canEdit,
  onShow,
}: {
  row: PersonRow;
  record: PersonRecord;
  companies: Ref[];
  owners: Ref[];
  canEdit: boolean;
  onShow: (tab: string) => void;
}) {
  const router = useRouter();
  const openClient = useOpenClient();
  const lastMail = record.mail[0] ?? null;
  const openDeal = record.deals.find((d) => d.category === "open") ?? record.deals[0] ?? null;

  const save = (key: string) => async (value: CrmValue) => {
    const res = await setField({ object: "person", id: row.id, key, value });
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  };
  const field = (key: string, label: string, kind: CellKind, value: CrmValue, refs?: Ref[]): [string, ReactNode] => [
    label,
    <EditableCell key={key} kind={kind} value={value} refs={refs} editable={canEdit} label={`${label} of ${row.name}`} onSave={save(key)} />,
  ];

  const activity: ActivityItem[] = [
    ...record.notes.map((n) => ({
      key: `n${n.id}`,
      at: n.createdAt,
      icon: "chat" as const,
      tab: "notes",
      text: (
        <>
          <span className="font-medium">{n.author?.name ?? "Someone"}</span> <span className="text-muted-foreground">added a note</span> {n.body}
        </>
      ),
    })),
    ...record.mail.slice(0, 20).map((m) => ({
      key: `m${m.id}`,
      at: m.sentAt,
      icon: "mail" as const,
      tab: "email",
      text: (
        <>
          <span className="text-muted-foreground">{m.direction === "inbound" ? "Email from them" : "Email sent"}</span> {m.subject || "(no subject)"}
        </>
      ),
    })),
    ...record.deals.map((d) => ({
      key: `d${d.id}`,
      at: d.leadDate,
      icon: "target" as const,
      tab: "deals",
      text: (
        <>
          <span className="text-muted-foreground">Deal</span> {d.title} <span className="text-muted-foreground">· {d.stage}</span>
        </>
      ),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <PanelSection title="Highlights">
        <div className="grid gap-3 sm:grid-cols-2">
          <Highlight label="Connection strength" icon="activity" onClick={record.mail.length ? () => onShow("email") : undefined}>
            <span className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", STRENGTH_DOT[record.strength])} aria-hidden />
              <span className={cn(record.strength === "none" && "text-muted-foreground")}>{CONNECTION_LABELS[record.strength]}</span>
            </span>
            <span className="text-muted-foreground text-caption">
              {record.mail.length ? `${record.mail.length} email${record.mail.length === 1 ? "" : "s"}` : "No email yet"}
            </span>
          </Highlight>
          <Highlight label="Last interaction" icon="mail" onClick={lastMail ? () => onShow("email") : undefined}>
            {lastMail ? (
              <>
                <span className="truncate">{lastMail.subject || "(no subject)"}</span>
                <span className="text-muted-foreground text-caption">{formatRelative(lastMail.sentAt)}</span>
              </>
            ) : (
              <HighlightEmpty>No email yet</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Company" icon="clients" onClick={record.company?.clientId ? () => openClient(record.company!.clientId) : undefined}>
            {record.company ? (
              <>
                <span className="truncate">{record.company.name}</span>
                <span className="text-muted-foreground truncate text-caption">{record.company.clientId ? "Client · open" : (record.company.domain ?? "Prospect")}</span>
              </>
            ) : (
              <HighlightEmpty>No company</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Email address" icon="mail">
            {row.email ? (
              <a href={`mailto:${row.email}`} className="truncate underline-offset-2 hover:underline">
                {row.email}
              </a>
            ) : (
              <HighlightEmpty>No email address</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Phone number" icon="phone">
            {row.phone ? (
              <a href={`tel:${row.phone}`} className="tabular truncate underline-offset-2 hover:underline">
                {row.phone}
              </a>
            ) : (
              <HighlightEmpty>No phone number</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Deals" icon="target" onClick={record.deals.length ? () => onShow("deals") : undefined}>
            {openDeal ? (
              <>
                <span className="truncate">{openDeal.title}</span>
                <span className="text-muted-foreground truncate text-caption">
                  {openDeal.stage}
                  {record.deals.length > 1 && ` · ${record.deals.length} deals`}
                </span>
              </>
            ) : (
              <HighlightEmpty>No deals</HighlightEmpty>
            )}
          </Highlight>
        </div>
      </PanelSection>

      <PanelSection title="Activity">
        <ActivityList items={activity} empty="No notes, email or deals yet." onShow={onShow} />
      </PanelSection>

      <PanelSection title="Details">
        <DetailList
          className="self-stretch"
          grid
          items={[
            field("name", "Name", "text", row.name),
            field("email", "Email", "email", row.email),
            field("phone", "Phone", "phone", row.phone),
            field("jobTitle", "Job title", "text", row.jobTitle),
            field("country", "Country", "ref", row.country, COUNTRY_REFS),
            field("companyId", "Company", "ref", row.company?.id ?? null, companies),
            field("ownerId", "Owner", "ref", row.owner?.id ?? null, owners),
            ["Added", formatDate(row.createdOn)],
          ]}
        />
      </PanelSection>
    </div>
  );
}

type DealRow = PersonRecord["deals"][number];

/** Their deals; a row opens the deal on the pipeline. */
function PersonDeals({ deals }: { deals: DealRow[] }) {
  const columns: Column<DealRow>[] = [
    { id: "title", header: "Deal", primary: true, sortValue: (d) => d.title.toLowerCase(), cell: (d) => d.title },
    { id: "stage", header: "Stage", sortValue: (d) => d.stage, cell: (d) => <StatusBadge value={d.category} label={d.stage} /> },
    { id: "value", header: "Value", align: "right", sortValue: (d) => d.value, cell: (d) => <MoneyText value={d.value} currency={d.currency} /> },
    { id: "lead", header: "Lead in", sortValue: (d) => d.leadDate, cell: (d) => <span className="tabular">{formatDate(d.leadDate)}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={deals}
      getRowId={(d) => d.id}
      getRowHref={(d) => `/sales?deal=${d.id}`}
      emptyTitle="No deals yet"
      emptyDescription="Deals with this person as their contact show here."
    />
  );
}
