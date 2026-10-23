"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RatingTask } from "@/lib/kpi/ratings";
import { formatDate, formatMonth } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { FormField } from "@/components/form-field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { approveRating, submitRating } from "@/app/(app)/ratings/actions";

const period = (t: RatingTask) => (t.frequency === "weekly" ? `Week of ${formatDate(t.periodStart)}` : formatMonth(t.periodStart));

/** The ratings you owe this period; filled ones can be changed until approved. */
export function RatingTasksTable({ tasks }: { tasks: RatingTask[] }) {
  const [rating, setRating] = useState<RatingTask | null>(null);
  const columns: Column<RatingTask>[] = [
    { id: "person", header: "Person", primary: true, cell: (t) => t.subject.name, sortValue: (t) => t.subject.name },
    { id: "form", header: "Form", cell: (t) => t.formName, sortValue: (t) => t.formName },
    { id: "period", header: "Period", cell: (t) => <span className="tabular">{period(t)}</span>, sortValue: (t) => t.periodStart },
    {
      id: "status",
      header: "Status",
      cell: (t) => <StatusBadge value={t.response ? (t.response.approved ? "approved" : "on_track") : "pending"} label={t.response ? (t.response.approved ? "Approved" : "Submitted") : "To do"} />,
      sortValue: (t) => (t.response ? 1 : 0),
    },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (t) => <RowActions label="Rating actions" actions={[{ label: t.response ? "Change rating" : "Rate", icon: "edit", hidden: t.response?.approved, onSelect: () => setRating(t) }]} />,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={tasks}
        getRowId={(t) => `${t.formId}:${t.subject.id}`}
        emptyTitle="No ratings to give"
        emptyDescription="When a form names you as a rater, the people to rate show up here each week or month."
      />
      {rating && <RatingDialog task={rating} onClose={() => setRating(null)} />}
    </>
  );
}

function RatingDialog({ task, onClose }: { task: RatingTask; onClose: () => void }) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>(task.response?.scores ?? {});
  const [comment, setComment] = useState(task.response?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const low = Object.values(scores).some((s) => s < 3);
  const complete = task.criteria.every((c) => scores[c.id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <form
          className="grid gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await submitRating({ formId: task.formId, subjectId: task.subject.id, periodStart: task.periodStart, scores, comment });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Rating saved");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {task.formName} · {task.subject.name}
            </DialogTitle>
            <DialogDescription>{period(task)}. A comment is required for any score under 3.</DialogDescription>
          </DialogHeader>
          {task.criteria.map((c) => (
            <fieldset key={c.id} className="grid gap-2">
              <legend className="text-body mb-1 font-medium">{c.title}</legend>
              <RadioGroup value={scores[c.id] ? String(scores[c.id]) : undefined} onValueChange={(v) => setScores({ ...scores, [c.id]: Number(v) })}>
                {c.scale.map((label, i) => (
                  <RadioItem key={i} index={i} value={String(i + 1)} label={`${i + 1} — ${label}`} />
                ))}
              </RadioGroup>
            </fieldset>
          ))}
          <FormField label="Comment" htmlFor="rt-comment" required={low}>
            <Textarea id="rt-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !complete || (low && !comment.trim())}>
              Save rating
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Approval = { id: string; formName: string; subject: string; periodStart: string; average: number; comment: string | null; scores: { title: string; score: number | null }[] };

/** Self-assessments waiting for HR. */
export function RatingApprovalsTable({ rows }: { rows: Approval[] }) {
  const router = useRouter();
  const columns: Column<Approval>[] = [
    { id: "person", header: "Person", primary: true, cell: (r) => r.subject, sortValue: (r) => r.subject },
    { id: "form", header: "Form", cell: (r) => r.formName },
    { id: "period", header: "Period", cell: (r) => <span className="tabular">{formatMonth(r.periodStart)}</span>, sortValue: (r) => r.periodStart },
    { id: "avg", header: "Average", align: "right", cell: (r) => <span className="tabular">{r.average.toFixed(2)}</span>, sortValue: (r) => r.average },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r) => (
        <RowActions
          label="Approval actions"
          actions={[
            {
              label: "Approve",
              icon: "check",
              onSelect: async () => {
                const res = await approveRating(r.id);
                if (!res.ok) return void toast.error(res.error);
                toast.success("Approved");
                router.refresh();
              },
            },
          ]}
        />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      renderExpanded={(r) => (
        <ul className="grid gap-1 text-body">
          {r.scores.map((s) => (
            <li key={s.title} className="flex justify-between gap-4">
              <span>{s.title}</span>
              <span className="tabular">{s.score ?? "—"}</span>
            </li>
          ))}
          {r.comment && <li className="text-muted-foreground">{r.comment}</li>}
        </ul>
      )}
      isRowExpandable={() => true}
      expandLabel={(r) => `Show ${r.subject}'s scores`}
      emptyTitle="Nothing to approve"
    />
  );
}
