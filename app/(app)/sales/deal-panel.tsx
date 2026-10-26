"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DealView } from "@/lib/sales/queries";
import type { DealRecord } from "@/lib/sales/record";
import { LEAD_SOURCE_LABELS } from "@/lib/sales/pure";
import { formatDate, formatMoney, formatRelative, sentenceEnum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { DetailList } from "@/components/detail-list";
import { MemberAvatar } from "@/components/member-avatar";
import { NotesPanel } from "@/components/crm/notes-panel";
import { MailActivity } from "@/components/mail/mail-activity";
import { useOpenClient } from "@/components/clients/client-panel";
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
import { ClientPeople } from "../clients/[id]/client-lists";
import { loadDealRecord } from "./actions";
import type { SalesChoices } from "./deal-dialog";

const PARAM = "deal";
// The row's stage, value and links are part of the key, so an edit or a move on the board refetches the panel.
const recordKey = (id: string | null, deal?: DealView | null) =>
  ["deal-record", id, deal ? [deal.stageId, deal.value, deal.currency, deal.person?.id, deal.company?.id, deal.project?.id] : null] as const;

/** Opens the deal panel on the pipeline (`?deal=<id>`, which also keeps the deal in the filtered list). */
export const useOpenDeal = () => useOpenRecord(PARAM);
export const useOpenDealId = () => useOpenRecordId(PARAM);

/**
 * A deal as a side panel over the pipeline: what the card shows and more —
 * stage progress, company and person, notes on the deal, email with its
 * people, and how it moved through the stages. Editing stays in the deal
 * dialog (`onEdit`).
 */
export function DealPanel({ deals, choices, onEdit }: { deals: DealView[]; choices: SalesChoices; onEdit: (id: string) => void }) {
  const dealId = useOpenDealId();
  const queryClient = useQueryClient();
  const deal = deals.find((d) => d.id === dealId) ?? null;
  const { data, isLoading, isError } = useQuery<DealRecord>({
    queryKey: recordKey(dealId, deal),
    queryFn: () => loadDealRecord(dealId),
    enabled: Boolean(dealId),
    staleTime: 0,
    // A refetch after an edit keeps the panel on screen; another deal's data is never shown (see `ready`).
    placeholderData: keepPreviousData,
  });
  const ready = Boolean(deal && data && data.id === deal.id);
  const reload = () => void queryClient.invalidateQueries({ queryKey: ["deal-record", dealId] });
  // Board order: by stage, then as listed.
  const position = new Map(choices.stages.map((s) => [s.id, s.position]));
  const ids = [...deals].sort((a, b) => (position.get(a.stageId) ?? 0) - (position.get(b.stageId) ?? 0)).map((d) => d.id);

  return (
    <RecordPanel
      param={PARAM}
      ids={ids}
      scope="Pipeline"
      noun="deal"
      storageKey="deal-panel-width"
      title={deal?.title}
      isLoading={(isLoading || Boolean(dealId)) && !ready && !isError}
      error={isError ? { title: "Couldn't load this deal", description: "It may have been deleted, or you can't see the pipeline." } : null}
    >
      {ready && deal && data && <DealRecordView key={deal.id} deal={deal} record={data} choices={choices} onEdit={() => onEdit(deal.id)} onChanged={reload} />}
    </RecordPanel>
  );
}

function DealRecordView({
  deal,
  record,
  choices,
  onEdit,
  onChanged,
}: {
  deal: DealView;
  record: DealRecord;
  choices: SalesChoices;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const stage = choices.stages.find((s) => s.id === deal.stageId);
  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", content: <Overview deal={deal} record={record} choices={choices} onShow={setTab} /> },
    {
      value: "notes",
      label: "Notes",
      count: record.notes.length,
      content: <NotesPanel target={{ dealId: deal.id }} notes={record.notes} canWrite={record.viewer.canWriteNotes} timeZone={record.viewer.timeZone} onChanged={onChanged} />,
    },
    {
      value: "email",
      label: "Email",
      count: record.mail.length,
      content: (
        <MailActivity
          messages={record.mail}
          timeZone={record.viewer.timeZone}
          emptyTitle="No email yet"
          emptyDescription={
            deal.person || deal.company
              ? "Mail with this deal's person or company shows here once a mailbox is connected in Mail."
              : "Link a person or company to the deal to see your email with them."
          }
        />
      ),
    },
    { value: "people", label: "People", count: record.people.length, content: <ClientPeople people={record.people} /> },
    { value: "history", label: "Stage history", count: record.history.length, content: <StageHistory record={record} /> },
  ];

  return (
    <RecordBody
      icon="target"
      title={deal.title}
      meta={
        <>
          {stage && <StatusBadge value={deal.category} label={stage.name} />}
          <span className="truncate">{[deal.company?.name ?? deal.client?.name ?? deal.prospectName, deal.person?.name].filter(Boolean).join(" · ")}</span>
        </>
      }
      actions={
        choices.canManage && (
          <Button type="button" variant="tertiary" size="sm" onClick={onEdit}>
            Edit deal
          </Button>
        )
      }
      tabs={tabs}
      tab={tab}
      onTab={setTab}
    />
  );
}

function Overview({ deal, record, choices, onShow }: { deal: DealView; record: DealRecord; choices: SalesChoices; onShow: (tab: string) => void }) {
  const openClient = useOpenClient();
  const stageName = new Map(choices.stages.map((s) => [s.id, s.name]));
  const stage = stageName.get(deal.stageId) ?? "—";
  const lastMail = record.mail[0] ?? null;
  const person = deal.person ? record.people.find((p) => p.id === deal.person!.id) : null;
  const clientId = deal.client?.id ?? record.companyClientId;
  const weighted = deal.category === "open" && deal.valueIdr !== null ? Math.round((deal.valueIdr * deal.probability) / 100) : null;

  const activity: ActivityItem[] = [
    ...record.history.map((h) => ({
      key: `h${h.id}`,
      at: h.at,
      icon: "kanban" as const,
      tab: "history",
      text: (
        <>
          <span className="font-medium">{h.by ?? "System"}</span> <span className="text-muted-foreground">{h.from ? "moved the deal to" : "added the deal in"}</span> {h.to}
        </>
      ),
    })),
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
          <span className="text-muted-foreground">{m.direction === "inbound" ? `Email from ${m.from.name || m.from.email}` : "Email sent"}</span> {m.subject || "(no subject)"}
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
          <Highlight label="Deal stage" icon="kanban" onClick={record.history.length ? () => onShow("history") : undefined}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate">{stage}</span>
              {deal.category === "open" && <span className="text-muted-foreground tabular text-caption">{deal.probability}%</span>}
            </span>
            <StageProgress stages={record.stages} current={stage} />
          </Highlight>
          <Highlight label="Deal value" icon="money">
            {deal.value ? (
              <>
                <span className="tabular truncate">{formatMoney(deal.value, deal.currency)}</span>
                {weighted !== null && <span className="text-muted-foreground tabular text-caption">{formatMoney(weighted, "IDR")} weighted</span>}
              </>
            ) : (
              <HighlightEmpty>No deal value</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Deal owner" icon="user">
            {deal.owner ? (
              <span className="flex min-w-0 items-center gap-2">
                <MemberAvatar seed={deal.owner.id} name={deal.owner.name} size={22} />
                <span className="truncate">{deal.owner.name}</span>
              </span>
            ) : (
              <HighlightEmpty>No owner</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Company" icon="clients" onClick={clientId ? () => openClient(clientId) : undefined}>
            {deal.company || deal.client || deal.prospectName ? (
              <>
                <span className="truncate">{deal.company?.name ?? deal.client?.name ?? deal.prospectName}</span>
                <span className="text-muted-foreground text-caption">{clientId ? "Client · open" : "Prospect"}</span>
              </>
            ) : (
              <HighlightEmpty>No company</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Associated person" icon="people" onClick={record.people.length ? () => onShow("people") : undefined}>
            {deal.person ? (
              <span className="flex min-w-0 items-center gap-2">
                <MemberAvatar seed={deal.person.id} name={deal.person.name} size={22} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{deal.person.name}</span>
                  {(person?.jobTitle || deal.person.email) && <span className="text-muted-foreground truncate text-caption">{person?.jobTitle ?? deal.person.email}</span>}
                </span>
              </span>
            ) : (
              <HighlightEmpty>No person</HighlightEmpty>
            )}
          </Highlight>
          <Highlight label="Last interaction" icon="mail" onClick={lastMail ? () => onShow("email") : undefined}>
            {lastMail ? (
              <>
                <span className="truncate">{lastMail.subject || "(no subject)"}</span>
                <span className="text-muted-foreground text-caption">{formatRelative(lastMail.sentAt)}</span>
              </>
            ) : deal.lastContactOn ? (
              <>
                <span>Contacted</span>
                <span className="text-muted-foreground tabular text-caption">{formatDate(deal.lastContactOn)}</span>
              </>
            ) : (
              <HighlightEmpty>No contact yet</HighlightEmpty>
            )}
          </Highlight>
          {deal.project && (
            <Highlight label="Next due task" icon="myTasks">
              {record.nextTask ? (
                <Link href={`/projects/${record.nextTask.projectId}?task=${record.nextTask.id}`} className="flex min-w-0 flex-col hover:underline">
                  <span className="truncate">{record.nextTask.title}</span>
                  <span className="text-muted-foreground tabular text-caption">
                    {record.nextTask.projectCode} · due {formatDate(record.nextTask.dueDate)}
                  </span>
                </Link>
              ) : (
                <HighlightEmpty>No next due task</HighlightEmpty>
              )}
            </Highlight>
          )}
        </div>
      </PanelSection>

      <PanelSection
        title="Activity"
        action={
          record.history.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onShow("history")}>
              View all
            </Button>
          )
        }
      >
        <ActivityList items={activity} empty="No moves, notes or email yet." onShow={onShow} />
      </PanelSection>

      <PanelSection title="Details">
        <DetailList
          className="self-stretch"
          grid
          wide={["Notes", "Lost reason"]}
          items={[
            ["Lead in", formatDate(deal.leadDate)],
            ["Last contact", deal.lastContactOn ? formatDate(deal.lastContactOn) : null],
            ["Lead source", deal.leadSource ? LEAD_SOURCE_LABELS[deal.leadSource] : null],
            ["Lead type", deal.leadType ? sentenceEnum(deal.leadType) : null],
            ...(deal.serviceType ? ([["Service", deal.serviceType]] as [string, string][]) : []),
            ...(deal.expectedClose ? ([["Expected close", formatDate(deal.expectedClose)]] as [string, string][]) : []),
            ["In stage", `${deal.daysInStage} day${deal.daysInStage === 1 ? "" : "s"}${deal.stale ? " · stale" : ""}`],
            ...(deal.category !== "open"
              ? ([
                  ["Last stage", deal.lastStageId ? (stageName.get(deal.lastStageId) ?? null) : null],
                  ["Closed", deal.closedOn ? formatDate(deal.closedOn) : null],
                ] as [string, string | null][])
              : []),
            ...(deal.category === "lost" ? ([["Lost reason", deal.lostReason]] as [string, string | null][]) : []),
            ...(deal.project
              ? ([
                  [
                    "Project",
                    <Link key="p" href={`/projects/${deal.project.id}`} className="tabular hover:underline">
                      {deal.project.code}
                    </Link>,
                  ],
                ] as [string, React.ReactNode][])
              : []),
            ["Notes", deal.notes],
          ]}
        />
      </PanelSection>
    </div>
  );
}

function StageHistory({ record }: { record: DealRecord }) {
  return (
    <ActivityList
      empty="No stage moves yet."
      onShow={() => {}}
      items={record.history.map((h) => ({
        key: h.id,
        at: h.at,
        icon: "kanban",
        text: (
          <>
            <span className="font-medium">{h.by ?? "System"}</span>{" "}
            {h.from ? (
              <>
                <span className="text-muted-foreground">moved</span> {h.from} <span className="text-muted-foreground">→</span> {h.to}
              </>
            ) : (
              <>
                <span className="text-muted-foreground">added the deal in</span> {h.to}
              </>
            )}{" "}
            <span className="text-muted-foreground tabular">· {formatMoney(h.value, h.currency)}</span>
          </>
        ),
      }))}
    />
  );
}
