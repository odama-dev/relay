"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { KeyResultKind, KeyResultSource } from "@prisma/client";
import type { KeyResultView, ObjectiveView } from "@/lib/kpi/okr";
import { formatMonth } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { PeoplePicker } from "@/components/people-picker";
import { AmountInput } from "@/components/amount-input";
import { CheckField } from "@/components/check-field";
import { checkInKeyResult, createObjective, saveKeyResult, updateObjective } from "@/app/(app)/okr/actions";

export type OkrOptions = {
  people: { id: string; name: string; avatarUrl: string | null }[];
  metrics: { id: string; name: string }[];
  tasks: { id: string; label: string }[];
  studio: { id: string; title: string }[];
  canStudio: boolean;
};

export function ObjectiveDialog({
  cycleId,
  viewerId,
  options,
  objective,
  onClose,
}: {
  cycleId: string;
  viewerId: string;
  options: OkrOptions;
  objective: ObjectiveView | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(objective?.title ?? "");
  const [description, setDescription] = useState(objective?.description ?? "");
  const [ownerIds, setOwnerIds] = useState<string[]>(objective?.owners.map((o) => o.id) ?? [viewerId]);
  const [parentId, setParentId] = useState(objective?.parent?.id ?? "");
  const [isStudio, setIsStudio] = useState(objective?.isStudio ?? false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const input = { cycleId, title, description, ownerIds, parentId, isStudio };
            const res = objective ? await updateObjective(objective.id, input) : await createObjective(input);
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success(objective ? "Saved" : "Objective added");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{objective ? "Edit objective" : "New objective"}</DialogTitle>
            <DialogDescription>Up to 5 objectives with up to 5 key results each. Team objectives are approved by HR.</DialogDescription>
          </DialogHeader>
          <FormField label="Objective" htmlFor="ob-title" required>
            <Input id="ob-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Why it matters" htmlFor="ob-desc">
            <Textarea id="ob-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Owners" required>
            <PeoplePicker people={options.people} value={ownerIds} onChange={setOwnerIds} className="border" placeholder="Add owners" />
          </FormField>
          {!isStudio && options.studio.length > 0 && (
            <FormField label="Supports studio objective" htmlFor="ob-parent">
              <SelectField id="ob-parent" value={parentId} onChange={setParentId} noneLabel="None" options={options.studio.map((s) => ({ value: s.id, label: s.title }))} />
            </FormField>
          )}
          {options.canStudio && !objective && (
            <CheckField id="ob-studio" checked={isStudio} onChange={setIsStudio} label="Studio objective" hint="One of the studio's 2–3 objectives for the quarter." />
          )}
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim() || !ownerIds.length}>
              {objective ? "Save" : "Add objective"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const KINDS: { value: KeyResultKind; label: string }[] = [
  { value: "milestone", label: "Milestone" },
  { value: "count", label: "Number" },
  { value: "percent", label: "Percentage" },
  { value: "lower_better", label: "Lower is better" },
  { value: "kpi_linked", label: "Linked to a KPI metric" },
];
const SOURCES: { value: KeyResultSource; label: string }[] = [
  { value: "manual", label: "Monthly check-in (with evidence)" },
  { value: "metric", label: "A metric (automatic)" },
  { value: "tasks", label: "Linked tasks (progress)" },
];

export function KeyResultDialog({ objectiveId, keyResult, options, onClose }: { objectiveId: string; keyResult: KeyResultView | null; options: OkrOptions; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(keyResult?.title ?? "");
  const [kind, setKind] = useState<KeyResultKind>(keyResult?.kind ?? "count");
  const [source, setSource] = useState<KeyResultSource>(keyResult?.source ?? "manual");
  const [metricId, setMetricId] = useState(keyResult?.metric?.id ?? "");
  const [startValue, setStart] = useState<number | null>(keyResult?.start ?? 0);
  const [targetValue, setTarget] = useState<number | null>(keyResult?.target ?? null);
  const [unit, setUnit] = useState(keyResult?.unit ?? "");
  const [doneDefinition, setDone] = useState(keyResult?.doneDefinition ?? "");
  const [approverId, setApprover] = useState(keyResult?.approver?.id ?? "");
  const [taskIds, setTaskIds] = useState<string[]>(keyResult?.tasks.map((t) => t.id) ?? []);
  const [busy, setBusy] = useState(false);
  const effectiveSource = kind === "kpi_linked" ? "metric" : source;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await saveKeyResult(objectiveId, keyResult?.id ?? null, { title, kind, source: effectiveSource, metricId, startValue, targetValue, unit, doneDefinition, approverId, taskIds });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success(keyResult ? "Saved" : "Key result added");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{keyResult ? "Edit key result" : "New key result"}</DialogTitle>
          </DialogHeader>
          <FormField label="Key result" htmlFor="kr-title" required>
            <Input id="kr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type" htmlFor="kr-kind" required>
              <SelectField id="kr-kind" value={kind} onChange={(v) => setKind(v as KeyResultKind)} options={KINDS} />
            </FormField>
            {kind !== "kpi_linked" && (
              <FormField label="Progress from" htmlFor="kr-source" required>
                <SelectField id="kr-source" value={source} onChange={(v) => setSource(v as KeyResultSource)} options={SOURCES} />
              </FormField>
            )}
            {effectiveSource === "metric" && (
              <FormField label="Metric" htmlFor="kr-metric" required>
                <SelectField id="kr-metric" value={metricId} onChange={setMetricId} placeholder="Pick a metric" options={options.metrics.map((m) => ({ value: m.id, label: m.name }))} />
              </FormField>
            )}
          </div>
          {kind === "milestone" ? (
            <>
              <FormField label="Definition of done" htmlFor="kr-done" required hint="What has to be true for it to count.">
                <Textarea id="kr-done" rows={2} value={doneDefinition} onChange={(e) => setDone(e.target.value)} />
              </FormField>
              <FormField label="Approver" htmlFor="kr-approver" required hint="Usually the direct manager.">
                <SelectField id="kr-approver" value={approverId} onChange={setApprover} placeholder="Pick a person" options={options.people.map((p) => ({ value: p.id, label: p.name }))} />
              </FormField>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Start" htmlFor="kr-start">
                <AmountInput id="kr-start" value={startValue} onChange={setStart} />
              </FormField>
              <FormField label="Target" htmlFor="kr-target" required>
                <AmountInput id="kr-target" value={targetValue} onChange={setTarget} />
              </FormField>
              <FormField label="Unit" htmlFor="kr-unit">
                <Input id="kr-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, leads, shots…" />
              </FormField>
            </div>
          )}
          {effectiveSource === "tasks" && (
            <FormField label="Linked tasks" hint="Progress = linked tasks approved ÷ linked tasks.">
              <PeoplePicker
                people={options.tasks.map((t) => ({ id: t.id, name: t.label, avatarUrl: null }))}
                value={taskIds}
                onChange={setTaskIds}
                className="border"
                placeholder="Add tasks"
              />
            </FormField>
          )}
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {keyResult ? "Save" : "Add key result"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CheckinDialog({ keyResult, month, onClose }: { keyResult: KeyResultView; month: string; onClose: () => void }) {
  const router = useRouter();
  const current = keyResult.checkins.find((c) => c.month === month);
  const [value, setValue] = useState<number | null>(current?.value ?? keyResult.current);
  const [note, setNote] = useState(current?.note ?? "");
  const [evidenceUrl, setEvidence] = useState(current?.evidenceUrl ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await checkInKeyResult(keyResult.id, { month, value, note, evidenceUrl });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Checked in");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>Check in · {formatMonth(month)}</DialogTitle>
            <DialogDescription>{keyResult.title}</DialogDescription>
          </DialogHeader>
          {keyResult.source === "manual" && keyResult.kind !== "milestone" && (
            <FormField label={`Current value${keyResult.unit ? ` (${keyResult.unit})` : ""}`} htmlFor="ci-value" required>
              <AmountInput id="ci-value" value={value} onChange={setValue} />
            </FormField>
          )}
          <FormField label="How it's going" htmlFor="ci-note">
            <Textarea id="ci-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <FormField label="Evidence link" htmlFor="ci-evidence" hint="Manual values need evidence.">
            <Input id="ci-evidence" value={evidenceUrl} onChange={(e) => setEvidence(e.target.value)} placeholder="https://" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (keyResult.source === "manual" && keyResult.kind !== "milestone" && (value === null || !evidenceUrl.trim()))}>
              Check in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
