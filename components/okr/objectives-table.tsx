"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { KeyResultView, ObjectiveView } from "@/lib/kpi/okr";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { ProgressBar } from "@/components/progress-bar";
import { MemberAvatar } from "@/components/member-avatar";
import { deleteKeyResult, deleteObjective, setMilestone, setObjectiveStatus } from "@/app/(app)/okr/actions";
import { CheckinDialog, KeyResultDialog, ObjectiveDialog, type OkrOptions } from "./okr-dialogs";

const tone = (p: number | null) => (p === null ? "muted" : p >= 70 ? "success" : p >= 40 ? "warning" : "destructive");

function Progress({ value }: { value: number | null }) {
  return (
    <span className="flex items-center gap-2">
      <ProgressBar value={value ?? 0} tone={tone(value)} className="h-1.5 w-24 shrink-0" />
      <span className="tabular w-10 text-right">{value === null ? "—" : `${value}%`}</span>
    </span>
  );
}

/** Objectives with their key results (expand a row); check-ins, milestones and approvals inline. */
export function ObjectivesTable({
  rows,
  cycleId,
  viewerId,
  month,
  options,
  canApprove,
}: {
  rows: ObjectiveView[];
  cycleId: string;
  viewerId: string;
  month: string;
  options: OkrOptions;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ObjectiveView | null>(null);
  const [kr, setKr] = useState<{ objectiveId: string; keyResult: KeyResultView | null } | null>(null);
  const [checkin, setCheckin] = useState<KeyResultView | null>(null);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, msg?: string) => {
    const res = await p;
    if (!res.ok) return void toast.error(res.error);
    if (msg) toast.success(msg);
    router.refresh();
  };

  const columns: Column<ObjectiveView>[] = [
    {
      id: "title",
      header: "Objective",
      primary: true,
      cell: (o) => o.title,
      sortValue: (o) => o.title,
    },
    { id: "level", header: "Level", cell: (o) => (o.isStudio ? "Studio" : "Team"), sortValue: (o) => (o.isStudio ? 0 : 1) },
    { id: "supports", header: "Supports", cell: (o) => (o.parent ? <span className="block max-w-56 truncate" title={o.parent.title}>{o.parent.title}</span> : <span className="text-muted-foreground">—</span>) },
    { id: "krs", header: "Key results", align: "right", cell: (o) => <span className="tabular">{o.keyResults.length}</span>, sortValue: (o) => o.keyResults.length },
    {
      id: "owners",
      header: "Owners",
      cell: (o) => (
        <span className="flex items-center -space-x-1.5" title={o.owners.map((w) => w.name).join(", ")}>
          {o.owners.slice(0, 4).map((w) => (
            <MemberAvatar key={w.id} seed={w.id} src={w.avatarUrl} name={w.name} size={20} className="ring-background ring-2" />
          ))}
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (o) => <StatusBadge value={o.status === "proposed" ? "pending" : o.status} label={o.status === "proposed" ? "Waiting for approval" : undefined} />, sortValue: (o) => o.status },
    { id: "progress", header: "Progress", cell: (o) => <Progress value={o.progress} />, sortValue: (o) => o.progress },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (o) => (
        <RowActions
          label={`Actions for ${o.title}`}
          actions={[
            { label: "Add key result", icon: "add", hidden: !o.canEdit, onSelect: () => setKr({ objectiveId: o.id, keyResult: null }) },
            { label: "Edit", icon: "edit", hidden: !o.canEdit, onSelect: () => setEditing(o) },
            { label: "Approve", icon: "check", hidden: !canApprove || o.status !== "proposed", onSelect: () => void act(setObjectiveStatus(o.id, "approved"), "Approved") },
            { label: "Archive", icon: "archive", hidden: !canApprove || o.status === "archived", onSelect: () => void act(setObjectiveStatus(o.id, "archived"), "Archived") },
            { label: "Delete", icon: "delete", destructive: true, hidden: !(o.status === "proposed" && (o.proposedBy === viewerId || canApprove)), onSelect: () => void act(deleteObjective(o.id), "Deleted") },
          ]}
        />
      ),
    },
  ];

  const krColumns = (o: ObjectiveView): Column<KeyResultView>[] => [
    {
      id: "title",
      header: "Key result",
      primary: true,
      cell: (k) => k.title,
    },
    {
      id: "measure",
      header: "Measure",
      cell: (k) => {
        const text =
          k.kind === "milestone"
            ? `Milestone · ${k.doneApproved ? "confirmed" : k.doneAt ? `done, waiting for ${k.approver?.name ?? "the approver"}` : (k.doneDefinition ?? "")}`
            : `${k.current ?? "—"} of ${k.target ?? "—"}${k.unit ? ` ${k.unit}` : ""}`;
        return <span className="block max-w-64 truncate" title={text}>{text}</span>;
      },
    },
    {
      id: "source",
      header: "Source",
      cell: (k) => (k.metric ? k.metric.name : k.source === "tasks" ? `${k.tasks.length} linked tasks` : <span className="text-muted-foreground">—</span>),
    },
    { id: "progress", header: "Progress", cell: (k) => <Progress value={k.progress} /> },
    {
      id: "checkin",
      header: "This month",
      cell: (k) => (k.source === "manual" || k.kind === "milestone" ? <StatusBadge value={k.checkedInThisMonth ? "approved" : "pending"} label={k.checkedInThisMonth ? "Checked in" : "Check-in due"} /> : <span className="text-muted-foreground text-caption">Automatic</span>),
    },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (k) => (
        <RowActions
          label={`Actions for ${k.title}`}
          actions={[
            { label: "Check in", icon: "edit", hidden: !o.isOwner && !canApprove, onSelect: () => setCheckin(k) },
            { label: "Mark done", icon: "check", hidden: k.kind !== "milestone" || !o.isOwner || Boolean(k.doneAt), onSelect: () => void act(setMilestone(k.id, "done"), "Marked done") },
            { label: "Confirm milestone", icon: "approvals", hidden: k.kind !== "milestone" || !k.doneAt || k.doneApproved || k.approver?.id !== viewerId, onSelect: () => void act(setMilestone(k.id, "confirm"), "Confirmed") },
            { label: "Reopen", icon: "restore", hidden: k.kind !== "milestone" || !k.doneAt || (!o.isOwner && !canApprove), onSelect: () => void act(setMilestone(k.id, "undo")) },
            { label: "Edit", icon: "edit", hidden: !o.canEdit, onSelect: () => setKr({ objectiveId: o.id, keyResult: k }) },
            { label: "Delete", icon: "delete", destructive: true, hidden: !o.canEdit, onSelect: () => void act(deleteKeyResult(k.id), "Deleted") },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(o) => o.id}
        renderExpanded={(o) => <DataTable columns={krColumns(o)} rows={o.keyResults} getRowId={(k) => k.id} emptyTitle="No key results yet" />}
        isRowExpandable={() => true}
        expandLabel={(o) => `Show key results for ${o.title}`}
        emptyTitle="No objectives here yet"
      />
      {editing && <ObjectiveDialog cycleId={cycleId} viewerId={viewerId} options={options} objective={editing} onClose={() => setEditing(null)} />}
      {kr && <KeyResultDialog objectiveId={kr.objectiveId} keyResult={kr.keyResult} options={options} onClose={() => setKr(null)} />}
      {checkin && <CheckinDialog keyResult={checkin} month={month} onClose={() => setCheckin(null)} />}
    </>
  );
}
