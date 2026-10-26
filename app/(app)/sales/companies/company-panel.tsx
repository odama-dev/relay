"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyRow, CrmFormOptions, Ref } from "@/lib/crm/queries";
import type { CompanyRecord } from "@/lib/crm/company-record";
import { ARR_RANGE_LABELS, CONNECTION_LABELS, EMPLOYEE_RANGE_LABELS, SOCIALS, SOCIAL_LABELS, type ConnectionStrength, type CrmValue } from "@/lib/crm/pure";
import { formatDate, formatMoney, formatNumber, formatRelative } from "@/lib/format";
import { countryLabel } from "@/lib/geo/pure";
import { cn } from "@/lib/utils";
import { COUNTRY_REFS } from "@/components/country-select";
import { Button } from "@/components/ui/button";
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
import { loadCompanyRecord, setField } from "../crm-actions";
import { CompanyForm } from "./company-form";

const PARAM = "company";

/** Opens the company panel on Companies (`?company=<id>`; `?company=new` for a new company). */
export const useOpenCompany = () => useOpenRecord(PARAM);
export const useOpenCompanyId = () => useOpenRecordId(PARAM);

const STRENGTH_DOT: Record<ConnectionStrength, string> = {
  very_strong: "bg-chart-in",
  strong: "bg-chart-in/60",
  weak: "bg-foreground/30",
  none: "bg-foreground/10",
};

/**
 * A company as a side panel over Companies: connection strength from email,
 * its team, deals, notes and mail, and every field. A new company and a
 * company's edit form open in the same panel (`?company=new`, `&edit=1`).
 */
export function CompanyPanel({ rows, owners, options, canEdit }: { rows: CompanyRow[]; owners: Ref[]; options: CrmFormOptions; canEdit: boolean }) {
  const companyId = useOpenCompanyId();
  const open = useOpenCompany();
  const editing = useRecordEditing();
  const queryClient = useQueryClient();
  const isNew = companyId === NEW_RECORD;
  const row = rows.find((r) => r.id === companyId) ?? null;
  const { data, isLoading, isError } = useQuery<CompanyRecord>({
    // Team size is part of the key: linking people from the form refetches the panel.
    queryKey: ["company-record", companyId, row?.people ?? null],
    queryFn: () => loadCompanyRecord(companyId),
    enabled: Boolean(companyId) && !isNew,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const ready = Boolean(row && data && data.id === row.id);
  const form = canEdit && (isNew || (editing && row));
  const reload = () => void queryClient.invalidateQueries({ queryKey: ["company-record", companyId] });

  return (
    <RecordPanel
      param={PARAM}
      ids={rows.map((r) => r.id)}
      scope="Companies"
      noun="company"
      storageKey="company-panel-width"
      title={isNew ? "New company" : row?.name}
      isLoading={!form && (isLoading || Boolean(companyId)) && !ready && !isError}
      error={!form && isError ? { title: "Couldn't load this company", description: "It may have been archived, or you can't see Sales." } : null}
    >
      {form ? (
        <CompanyForm
          key={row?.id ?? NEW_RECORD}
          company={row ?? undefined}
          options={options}
          onSaved={(id) => {
            open(id);
            reload();
          }}
          onCancel={() => open(row?.id ?? null)}
        />
      ) : (
        ready &&
        row &&
        data && <CompanyRecordView key={row.id} row={row} record={data} owners={owners} canEdit={canEdit} onEdit={() => open(row.id, { edit: true })} onChanged={reload} />
      )}
    </RecordPanel>
  );
}

function CompanyRecordView({
  row,
  record,
  owners,
  canEdit,
  onEdit,
  onChanged,
}: {
  row: CompanyRow;
  record: CompanyRecord;
  owners: Ref[];
  canEdit: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", content: <Overview row={row} record={record} owners={owners} canEdit={canEdit} onShow={setTab} /> },
    {
      value: "notes",
      label: "Notes",
      count: record.notes.length,
      content: <NotesPanel target={{ companyId: row.id }} notes={record.notes} canWrite={record.viewer.canWriteNotes} timeZone={record.viewer.timeZone} onChanged={onChanged} />,
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
          emptyDescription={row.domains.length ? "Mail with this company's domains or team shows here once a mailbox is connected in Mail." : "Add a domain to match your mail to this company."}
        />
      ),
    },
    { value: "team", label: "Team", count: record.people.length, content: <CompanyTeam companyId={row.id} people={record.people} /> },
    { value: "deals", label: "Deals", count: record.deals.length, content: <CompanyDeals deals={record.deals} /> },
  ];
  return (
    <RecordBody
      icon="clients"
      title={row.name}
      badge={<StatusBadge value={row.client ? "active" : "draft"} label={row.client ? "Client" : "Prospect"} />}
      meta={<span className="truncate">{[row.domain, row.country && countryLabel(row.country)].filter(Boolean).join(" · ") || "No domain"}</span>}
      actions={
        canEdit && (
          <Button type="button" variant="tertiary" size="sm" onClick={onEdit}>
            Edit company
          </Button>
        )
      }
      tabs={tabs}
      tab={tab}
      onTab={setTab}
    />
  );
}

function Overview({ row, record, owners, canEdit, onShow }: { row: CompanyRow; record: CompanyRecord; owners: Ref[]; canEdit: boolean; onShow: (tab: string) => void }) {
  const router = useRouter();
  const openClient = useOpenClient();
  const lastMail = record.mail[0] ?? null;
  const openDeal = record.deals.find((d) => d.category === "open") ?? record.deals[0] ?? null;

  const save = (key: string) => async (value: CrmValue) => {
    const res = await setField({ object: "company", id: row.id, key, value });
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  };
  const field = (key: string, label: string, kind: CellKind, value: CrmValue, refs?: Ref[]): [string, ReactNode] => [
    label,
    <EditableCell key={key} kind={kind} value={value} refs={refs} editable={canEdit} label={`${label} of ${row.name}`} onSave={save(key)} />,
  ];
  const text = (value: string | null | undefined): ReactNode => value || <span className="text-muted-foreground">—</span>;

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
          <Highlight label="Client" icon="clients" onClick={row.client ? () => openClient(row.client!.id) : undefined}>
            {row.client ? (
              <>
                <span className="truncate">{row.client.name}</span>
                <span className="text-muted-foreground text-caption">Client · open</span>
              </>
            ) : (
              <HighlightEmpty>Prospect</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Team" icon="people" onClick={record.people.length ? () => onShow("team") : undefined}>
            {record.people.length ? (
              <>
                <span className="truncate">{record.people[0].name}</span>
                <span className="text-muted-foreground truncate text-caption">
                  {record.people.length === 1 ? (record.people[0].jobTitle ?? "1 person") : `${record.people.length} people`}
                </span>
              </>
            ) : (
              <HighlightEmpty>No one yet</HighlightEmpty>
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
          <Highlight label="Funding raised" icon="money">
            {row.fundingRaised !== null && row.fundingCurrency ? (
              <>
                <span className="tabular truncate">{formatMoney(row.fundingRaised, row.fundingCurrency, { compact: true })}</span>
                <span className="text-muted-foreground truncate text-caption">{row.estimatedArr ? `ARR ${ARR_RANGE_LABELS[row.estimatedArr]}` : "ARR not set"}</span>
              </>
            ) : (
              <HighlightEmpty>Not set</HighlightEmpty>
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
            ["Domains", text(row.domains.join(", "))],
            field("description", "Description", "longtext", row.description),
            ["Categories", text(row.categories.join(", "))],
            field("country", "Country", "ref", row.country, COUNTRY_REFS),
            ...SOCIALS.map((s): [string, ReactNode] => [SOCIAL_LABELS[s], text(row[s])]),
            ["Twitter followers", row.twitterFollowers !== null ? <span className="tabular">{formatNumber(row.twitterFollowers)}</span> : text(null)],
            ["Estimated ARR", text(row.estimatedArr && ARR_RANGE_LABELS[row.estimatedArr])],
            ["Foundation date", text(row.foundedOn && formatDate(row.foundedOn))],
            ["Employee range", text(row.employeeRange && EMPLOYEE_RANGE_LABELS[row.employeeRange])],
            field("ownerId", "Owner", "ref", row.owner?.id ?? null, owners),
            ["Added", formatDate(row.createdOn)],
          ]}
        />
      </PanelSection>
    </div>
  );
}

type TeamRow = CompanyRecord["people"][number];

/** People at the company; a row opens them on People. */
function CompanyTeam({ companyId, people }: { companyId: string; people: TeamRow[] }) {
  const columns: Column<TeamRow>[] = [
    { id: "name", header: "Name", primary: true, sortValue: (p) => p.name.toLowerCase(), cell: (p) => p.name },
    { id: "job", header: "Job title", sortValue: (p) => p.jobTitle ?? "", cell: (p) => p.jobTitle ?? <span className="text-muted-foreground">—</span> },
    { id: "email", header: "Email", sortValue: (p) => p.email ?? "", cell: (p) => p.email ?? <span className="text-muted-foreground">—</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={people}
      getRowId={(p) => p.id}
      getRowHref={(p) => `/sales/people?company=${companyId}&person=${p.id}`}
      emptyTitle="No one yet"
      emptyDescription="Add people from Edit company, or set their company in People."
    />
  );
}

type DealRow = CompanyRecord["deals"][number];

/** Its deals; a row opens the deal on the pipeline. */
function CompanyDeals({ deals }: { deals: DealRow[] }) {
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
      emptyDescription="Deals with this company show here."
    />
  );
}
