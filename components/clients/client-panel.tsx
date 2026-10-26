"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClientRecord } from "@/lib/clients/record";
import type { CURRENCIES } from "@/lib/validation";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { deleteClient, loadClientRecord, setClientArchived } from "@/app/(app)/clients/actions";
import { ClientDeals, ClientInvoices, ClientPeople, ClientProjects } from "@/app/(app)/clients/[id]/client-lists";
import { ContactsPanel } from "@/app/(app)/clients/[id]/contacts-panel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { DetailList } from "@/components/detail-list";
import { MemberAvatar } from "@/components/member-avatar";
import { NotesPanel } from "@/components/crm/notes-panel";
import { MailActivity } from "@/components/mail/mail-activity";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ClientForm } from "@/components/clients/client-form";
import { ProjectFormDialog } from "@/app/(app)/projects/project-form-dialog";
import {
  ActivityList,
  Highlight,
  HighlightEmpty,
  NEW_RECORD,
  PanelSection,
  RecordBody,
  RecordPanel,
  StageProgress,
  useOpenRecord,
  useOpenRecordId,
  useRecordEditing,
  type ActivityItem,
  type RecordTab,
} from "@/components/record-panel";

const PARAM = "client";
const recordKey = (id: string | null) => ["client-record", id] as const;

/** Opens the client panel mounted on this page (`?client=<id>`; `?client=new` for a new client; see ClientPanel). */
export const useOpenClient = () => useOpenRecord(PARAM);
/** The id of the client whose panel is open, if any. */
export const useOpenClientId = () => useOpenRecordId(PARAM);

/**
 * A client as a side panel over the list it was opened from. Sales see the
 * account (deal, people, notes, email) first. A new client (`?client=new`,
 * with `canCreate`) and a client's edit form (`&edit=1`) open in the same panel.
 */
export function ClientPanel({ ids = [], scope = "Clients", canCreate = false }: { ids?: string[]; scope?: string; canCreate?: boolean }) {
  const clientId = useOpenClientId();
  const open = useOpenClient();
  const editing = useRecordEditing();
  const queryClient = useQueryClient();
  const isNew = clientId === NEW_RECORD;
  const { data, isLoading, isError } = useQuery<ClientRecord>({
    queryKey: recordKey(clientId),
    queryFn: () => loadClientRecord(clientId),
    enabled: Boolean(clientId) && !isNew,
    staleTime: 0,
  });
  const reload = () => void queryClient.invalidateQueries({ queryKey: recordKey(clientId) });
  const record = data && data.client.id === clientId ? data : null;
  const form = isNew ? canCreate : editing && record?.viewer.canEdit;

  return (
    <RecordPanel
      param={PARAM}
      ids={ids}
      scope={scope}
      noun="client"
      storageKey="client-panel-width"
      title={isNew ? "New client" : data?.client.name}
      fullPageHref={clientId && !isNew ? `/clients/${clientId}` : undefined}
      isLoading={!form && !isNew && isLoading}
      error={!form && !isNew && isError ? { title: "Couldn't load this client", description: "It may have been removed, or you can't see it." } : null}
    >
      {form ? (
        <ClientForm
          key={record?.client.id ?? NEW_RECORD}
          client={isNew ? undefined : record!.client}
          onSaved={(id) => {
            open(id);
            void queryClient.invalidateQueries({ queryKey: recordKey(id) });
          }}
          onCancel={() => open(isNew ? null : clientId)}
        />
      ) : (
        record && <ClientRecordView key={record.client.id} record={record} onEdit={() => open(record.client.id, { edit: true })} onChanged={reload} />
      )}
    </RecordPanel>
  );
}

/** Edit, archive / restore and (with no history) delete, beside the client's name. */
function ClientActions({ record, onEdit, onChanged }: { record: ClientRecord; onEdit: () => void; onChanged: () => void }) {
  const { client } = record;
  const router = useRouter();
  const pathname = usePathname();
  const open = useOpenClient();
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Button type="button" variant="tertiary" size="sm" onClick={onEdit}>
        Edit client
      </Button>
      <RowActions
        label={`Actions for ${client.name}`}
        variant="tertiary"
        actions={[
          {
            label: client.isArchived ? "Restore" : "Archive",
            icon: client.isArchived ? "restore" : "archive",
            onSelect: async () => {
              const res = await setClientArchived(client.id, !client.isArchived);
              if (!res.ok) return void toast.error(res.error);
              toast.success(client.isArchived ? "Client restored" : "Client archived");
              onChanged();
              router.refresh();
            },
          },
          { label: "Delete", icon: "delete", destructive: true, hidden: client.hasHistory, onSelect: () => setDeleting(true) },
        ]}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${client.name}?`}
        description="The client has no projects or invoices, so it can be removed for good."
        confirmLabel="Delete client"
        destructive
        onConfirm={async () => {
          const res = await deleteClient(client.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Client deleted");
          // On the client's own page there's nothing left to show.
          if (pathname === `/clients/${client.id}`) router.push("/clients");
          else {
            open(null);
            router.refresh();
          }
        }}
      />
    </>
  );
}

/** A project for this client, from its panel; the panel stays open and shows it under Projects. */
function NewProjectButton({ record, onCreated }: { record: ClientRecord; onCreated: () => void }) {
  const { client } = record;
  const choices = record.newProject!;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="tertiary" size="sm" onClick={() => setOpen(true)}>
        New project
      </Button>
      {open && (
        <ProjectFormDialog
          open
          onOpenChange={setOpen}
          clients={[{ id: client.id, code: client.code, name: client.name, defaultCurrency: client.defaultCurrency }]}
          pms={choices.pms}
          canEditContract={choices.canEditContract}
          onCreated={() => {
            onCreated();
            router.refresh();
          }}
          defaults={{
            name: "",
            kind: "client",
            clientId: client.id,
            contractType: "fixed",
            currency: client.defaultCurrency as (typeof CURRENCIES)[number],
            contractValue: null,
            retainerFeePerMonth: null,
            pmId: choices.defaultPmId,
            status: "active",
            startDate: choices.today,
            endDate: "",
            links: { notion: "", figma: "", drive: "", slack_channel: "" },
            budget: { budgetHours: null, retainerHoursPerMonth: null, rolloverMode: "none", rolloverCapHours: null, alertThresholds: choices.thresholds },
          }}
        />
      )}
    </>
  );
}

function ClientRecordView({ record, onEdit, onChanged }: { record: ClientRecord; onEdit: () => void; onChanged: () => void }) {
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
    { value: "projects", label: "Projects", count: client.projects.length, content: <ClientProjects projects={client.projects} /> },
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
      badge={client.isArchived && <StatusBadge value="archived" />}
      meta={
        <>
          <span className="tabular">{client.code}</span>
          {sales?.company?.domain && <span className="truncate">{sales.company.domain}</span>}
        </>
      }
      actions={
        <>
          {record.newProject && (
            <NewProjectButton
              record={record}
              onCreated={() => {
                onChanged();
                setTab("projects");
              }}
            />
          )}
          {viewer.canEdit && <ClientActions record={record} onEdit={onEdit} onChanged={onChanged} />}
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
