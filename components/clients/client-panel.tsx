"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientRecord } from "@/lib/clients/record";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { loadClientRecord } from "@/app/(app)/clients/actions";
import { ClientDeals, ClientInvoices, ClientPeople, ClientProjects } from "@/app/(app)/clients/[id]/client-lists";
import { ContactsPanel } from "@/app/(app)/clients/[id]/contacts-panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { DetailList } from "@/components/detail-list";
import { MemberAvatar } from "@/components/member-avatar";
import { NotesPanel } from "@/components/crm/notes-panel";
import { MailActivity } from "@/components/mail/mail-activity";
import {
  ActivityList,
  Highlight,
  HighlightEmpty,
  PanelSection,
  RecordBody,
  RecordPanel,
  StageProgress,
  useOpenRecord,
  useOpenRecordId,
  type ActivityItem,
  type RecordTab,
} from "@/components/record-panel";

const PARAM = "client";
const recordKey = (id: string | null) => ["client-record", id] as const;

/** Opens the client panel mounted on this page (`?client=<id>`, see ClientPanel). */
export const useOpenClient = () => useOpenRecord(PARAM);
/** The id of the client whose panel is open, if any. */
export const useOpenClientId = () => useOpenRecordId(PARAM);

/** A client as a side panel over the list it was opened from. Sales see the account (deal, people, notes, email) first. */
export function ClientPanel({ ids = [], scope = "Clients" }: { ids?: string[]; scope?: string }) {
  const clientId = useOpenClientId();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<ClientRecord>({
    queryKey: recordKey(clientId),
    queryFn: () => loadClientRecord(clientId),
    enabled: Boolean(clientId),
    staleTime: 0,
  });
  const reload = () => void queryClient.invalidateQueries({ queryKey: recordKey(clientId) });

  return (
    <RecordPanel
      param={PARAM}
      ids={ids}
      scope={scope}
      noun="client"
      storageKey="client-panel-width"
      title={data?.client.name}
      fullPageHref={clientId ? `/clients/${clientId}` : undefined}
      isLoading={isLoading}
      error={isError ? { title: "Couldn't load this client", description: "It may have been removed, or you can't see it." } : null}
    >
      {data && <ClientRecordView key={data.client.id} record={data} onChanged={reload} />}
    </RecordPanel>
  );
}

function ClientRecordView({ record, onChanged }: { record: ClientRecord; onChanged: () => void }) {
  const { client, sales, mail, viewer } = record;
  const [tab, setTab] = useState("overview");

  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", content: <Overview record={record} onShow={setTab} /> },
    ...(sales
      ? [
          {
            value: "notes",
            label: "Notes",
            count: sales.notes.length,
            content: <NotesPanel target={{ clientId: client.id }} notes={sales.notes} canWrite={viewer.canWriteNotes} timeZone={viewer.timeZone} onChanged={onChanged} />,
          },
          { value: "deals", label: "Deals", count: sales.deals.length, content: <ClientDeals deals={sales.deals} /> },
          {
            value: "email",
            label: "Email",
            count: mail.length,
            content: (
              <MailActivity
                messages={mail}
                timeZone={viewer.timeZone}
                emptyTitle="No email yet"
                emptyDescription="Mail with this company or its people shows here once a mailbox is connected in Mail."
              />
            ),
          },
          { value: "people", label: "People", count: sales.people.length, content: <ClientPeople people={sales.people} /> },
        ]
      : []),
    ...(viewer.salesView ? [] : [{ value: "projects", label: "Projects", count: client.projects.length, content: <ClientProjects projects={client.projects} /> }]),
    {
      value: "contacts",
      label: "Billing contacts",
      count: client.contacts.length,
      content: <ContactsPanel clientId={client.id} contacts={client.contacts} canEdit={viewer.canEdit} onChanged={onChanged} />,
    },
    ...(viewer.canViewInvoices ? [{ value: "invoices", label: "Invoices", count: client.invoices.length, content: <ClientInvoices invoices={client.invoices} /> }] : []),
  ];

  return (
    <RecordBody
      icon="clients"
      title={client.name}
      meta={
        <>
          <span className="tabular">{client.code}</span>
          {sales?.company?.domain && <span className="truncate">{sales.company.domain}</span>}
          {client.isArchived && <StatusBadge value="archived" />}
        </>
      }
      tabs={tabs}
      tab={tab}
      onTab={setTab}
    />
  );
}

function Overview({ record, onShow }: { record: ClientRecord; onShow: (tab: string) => void }) {
  const { client, sales, mail, stages, nextTask } = record;
  const deal = sales?.current ?? null;
  const lastMail = mail[0] ?? null;

  const activity: ActivityItem[] = [
    ...(sales?.notes ?? []).map((n) => ({
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
    ...mail.slice(0, 20).map((m) => ({
      key: `m${m.id}`,
      at: m.sentAt,
      icon: "mail" as const,
      tab: "email",
      text: (
        <>
          <span className="text-muted-foreground">{m.direction === "inbound" ? `Email from ${m.from.name || m.from.email}` : "Email sent"}</span> {m.subject || "(no subject)"}
        </>
      ),
    })),
    ...(sales?.deals ?? []).map((d) => ({
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
          {sales ? (
            <>
              <Highlight label="Deal stage" icon="kanban" onClick={deal ? () => onShow("deals") : undefined}>
                {deal ? (
                  <>
                    <span className="truncate">{deal.stage}</span>
                    <StageProgress stages={stages} current={deal.stage} />
                  </>
                ) : (
                  <HighlightEmpty>No deal</HighlightEmpty>
                )}
              </Highlight>
              <Highlight label="Deal value" icon="money">
                {deal && deal.value ? <span className="tabular truncate">{formatMoney(deal.value, deal.currency)}</span> : <HighlightEmpty>No deal value</HighlightEmpty>}
              </Highlight>
              <Highlight label="Deal owner" icon="user">
                {deal?.owner ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <MemberAvatar seed={deal.owner.id} name={deal.owner.name} size={22} />
                    <span className="truncate">{deal.owner.name}</span>
                  </span>
                ) : (
                  <HighlightEmpty>No owner</HighlightEmpty>
                )}
              </Highlight>
            </>
          ) : (
            <>
              <Highlight label="Active projects" icon="projects" onClick={() => onShow("projects")}>
                <span className="tabular">
                  {client.projects.filter((p) => p.status === "active" || p.status === "on_hold").length}
                  <span className="text-muted-foreground"> / {client.projects.length}</span>
                </span>
              </Highlight>
              <Highlight label="Primary contact" icon="user" onClick={() => onShow("contacts")}>
                {client.contacts[0] ? <span className="truncate">{client.contacts[0].name}</span> : <HighlightEmpty>No contact</HighlightEmpty>}
              </Highlight>
            </>
          )}
          <Highlight label="Next due task" icon="myTasks">
            {nextTask ? (
              <Link href={`/projects/${nextTask.projectId}?task=${nextTask.id}`} className="flex min-w-0 flex-col hover:underline">
                <span className="truncate">{nextTask.title}</span>
                <span className="text-muted-foreground tabular text-caption">
                  {nextTask.projectCode} · due {formatDate(nextTask.dueDate)}
                </span>
              </Link>
            ) : (
              <HighlightEmpty>No next due task</HighlightEmpty>
            )}
          </Highlight>
          {sales && (
            <>
              <Highlight label="Associated people" icon="people" onClick={sales.people.length ? () => onShow("people") : undefined}>
                {sales.people.length ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0 -space-x-1.5">
                      {sales.people.slice(0, 3).map((p) => (
                        <MemberAvatar key={p.id} seed={p.id} name={p.name} size={22} className="ring-background ring-2" />
                      ))}
                    </span>
                    <span className="truncate">
                      {sales.people[0].name}
                      {sales.people.length > 1 && <span className="text-muted-foreground"> +{sales.people.length - 1}</span>}
                    </span>
                  </span>
                ) : (
                  <HighlightEmpty>No people</HighlightEmpty>
                )}
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
            </>
          )}
        </div>
      </PanelSection>

      {sales && (
        <PanelSection
          title="Activity"
          action={
            sales.notes.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onShow("notes")}>
                View notes
              </Button>
            )
          }
        >
          <ActivityList items={activity} empty="No notes, email or deals yet." onShow={onShow} />
        </PanelSection>
      )}

      <PanelSection title="Details">
        <DetailList
          items={[
            ...(sales?.company ? ([["Company", sales.company.name]] as [string, string | null][]) : []),
            ["Default currency", client.defaultCurrency],
            ["Country", client.country],
            ["Time zone", client.timezone],
            ["Billing email", client.billingEmail],
            ["Billing address", client.billingAddress],
            ["Notes", client.notes],
          ]}
          className="self-stretch"
          grid
          wide={["Notes"]}
        />
      </PanelSection>
    </div>
  );
}
