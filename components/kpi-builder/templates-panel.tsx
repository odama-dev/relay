"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Builder } from "@/lib/kpi/builder";
import { formatDate } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { RowActions } from "@/components/row-actions";
import { PillButton } from "@/components/pill-button";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { AmountInput } from "@/components/amount-input";
import { CheckField } from "@/components/check-field";
import { WarningList } from "@/components/warning-list";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  activateTemplate,
  archiveTemplate,
  createTemplate,
  deleteTemplateDraft,
  newTemplateVersion,
  saveTemplateDraft,
  simulateTemplateAction,
} from "@/app/(app)/performance/actions";

type Template = Builder["templates"][number];
type Item = Template["current"]["items"][number];

/** KPI templates: metrics + targets + score period + weights, versioned (Draft → Active from next month → Archived). */
export function TemplatesPanel({ templates, metrics }: { templates: Template[]; metrics: Builder["metrics"] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, msg?: string) => {
    const res = await p;
    if (!res.ok) return void toast.error(res.error);
    if (msg) toast.success(msg);
    router.refresh();
  };
  const columns: Column<Template>[] = [
    {
      id: "name",
      header: "Template",
      primary: true,
      cell: (t) => t.name,
      sortValue: (t) => t.name,
    },
    { id: "kind", header: "Kind", cell: (t) => (t.kind === "core" ? "Core" : "Add-on"), sortValue: (t) => t.kind },
    { id: "metrics", header: "Metrics", align: "right", cell: (t) => <span className="tabular">{t.current.items.length}</span>, sortValue: (t) => t.current.items.length },
    {
      id: "live",
      header: "Live version",
      cell: (t) => (t.live ? <span className="tabular">v{t.live.version}{t.live.effectiveFrom ? ` · from ${formatDate(t.live.effectiveFrom)}` : ""}</span> : <span className="text-muted-foreground">—</span>),
    },
    { id: "draft", header: "", cell: (t) => (t.draft ? <StatusBadge value="draft" label={`Draft v${t.draft.version}`} /> : null) },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (t) => (
        <RowActions
          label={`Actions for ${t.name}`}
          actions={[
            { label: t.draft ? "Edit draft" : "Open", icon: "edit", onSelect: () => setOpen(t) },
            { label: "New version", icon: "add", hidden: Boolean(t.draft), onSelect: () => void act(newTemplateVersion(t.lineageId), "Draft created") },
            { label: "Archive", icon: "archive", hidden: !t.live, onSelect: () => void act(archiveTemplate(t.live!.id), "Archived") },
          ]}
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
        <p className="text-muted-foreground text-caption">Changes go into a new version and start next month — scores already recorded don&apos;t change.</p>
        <PillButton icon="add" onClick={() => setCreating(true)}>
          New template
        </PillButton>
      </div>
      <DataTable columns={columns} rows={templates} getRowId={(t) => t.lineageId} emptyTitle="No templates yet" />
      {open && <TemplateDialog template={open} metrics={metrics} onClose={() => setOpen(null)} />}
      {creating && <NewTemplateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewTemplateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"core" | "addon">("core");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await createTemplate({ name, kind });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Draft created — add its metrics");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>New KPI template</DialogTitle>
          </DialogHeader>
          <FormField label="Name" htmlFor="nt-name" required>
            <Input id="nt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design Core" />
          </FormField>
          <FormField label="Kind" htmlFor="nt-kind">
            <SelectField
              id="nt-kind"
              value={kind}
              onChange={(v) => setKind(v as "core" | "addon")}
              options={[
                { value: "core", label: "Core — the base KPI of a role" },
                { value: "addon", label: "Add-on — on top of the core" },
              ]}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ template, metrics, onClose }: { template: Template; metrics: Builder["metrics"]; onClose: () => void }) {
  const router = useRouter();
  const t = template.current;
  const editable = t.status === "draft";
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description ?? "");
  const [items, setItems] = useState<Item[]>(t.items);
  const [sim, setSim] = useState<{ name: string; score: number | null; grade: string | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const metricOf = (id: string) => metrics.find((m) => m.id === id);
  const set = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const payload = items.map((i) => ({ metricId: i.metricId, target: i.recordOnly ? null : i.target, targetPer: i.targetPer, scorePeriod: i.scorePeriod, weight: i.recordOnly ? 0 : i.weight, recordOnly: i.recordOnly, tag: i.tag }));
  const run = async (p: Promise<{ ok: boolean; error?: string }>, msg: string, close = false) => {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(msg);
    if (close) onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {t.name} · {editable ? `Draft v${template.draft?.version}` : `v${template.live?.version ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {editable ? "Activating starts it on the 1st of next month and archives the version it replaces." : "This version is live and locked. Create a new version to change it."}
            </DialogDescription>
          </DialogHeader>
          <WarningList warnings={t.warnings} className="mx-0 border-y" />
          {editable && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name" htmlFor="tp-name">
                <Input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Notes" htmlFor="tp-desc">
                <Textarea id="tp-desc" rows={1} value={description} onChange={(e) => setDescription(e.target.value)} />
              </FormField>
            </div>
          )}
          <div className="grid gap-3">
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                  <SelectField aria-label="Metric" disabled={!editable} value={it.metricId} onChange={(v) => set(i, { metricId: v, metricName: metricOf(v)?.name ?? "", unit: metricOf(v)?.unit ?? "" })} options={metrics.filter((m) => m.status === "active" || m.id === it.metricId).map((m) => ({ value: m.id, label: m.name }))} />
                  <Input aria-label="Tag filter" disabled={!editable} value={it.tag ?? ""} onChange={(e) => set(i, { tag: e.target.value || null })} placeholder="Tag (optional)" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <AmountInput aria-label="Target" disabled={!editable || it.recordOnly} value={it.target} onChange={(v) => set(i, { target: v })} placeholder="Target" />
                  <SelectField
                    aria-label="Target per"
                    disabled={!editable}
                    value={it.targetPer}
                    onChange={(v) => set(i, { targetPer: v as Item["targetPer"] })}
                    options={[
                      { value: "week", label: "per week" },
                      { value: "month", label: "per month" },
                      { value: "semester", label: "per 6 months" },
                    ]}
                  />
                  <SelectField
                    aria-label="Score period"
                    disabled={!editable}
                    value={it.scorePeriod}
                    onChange={(v) => set(i, { scorePeriod: v as Item["scorePeriod"] })}
                    options={[
                      { value: "monthly", label: "Scored monthly" },
                      { value: "semester", label: "Scored per semester" },
                    ]}
                  />
                  <AmountInput aria-label="Weight" disabled={!editable || it.recordOnly} value={it.weight} onChange={(v) => set(i, { weight: v ?? 0 })} placeholder="Weight" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <CheckField id={`ro-${i}`} disabled={!editable} checked={it.recordOnly} onChange={(recordOnly) => set(i, { recordOnly })} label="Recorded only — not scored" />
                  {editable && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {editable && (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="tertiary"
                  onClick={() => {
                    const m = metrics.find((x) => x.status === "active");
                    if (m) setItems([...items, { metricId: m.id, metricName: m.name, unit: m.unit, target: null, targetPer: "month", scorePeriod: "monthly", weight: 1, recordOnly: false, tag: null }]);
                  }}
                >
                  Add metric
                </Button>
              </div>
            )}
          </div>
          {sim && (
            <ul className="grid gap-1 rounded-lg border p-3 text-body">
              <li className="text-muted-foreground text-caption">Simulation with last month&apos;s data</li>
              {sim.map((r) => (
                <li key={r.name} className="flex justify-between gap-4">
                  <span>{r.name}</span>
                  <span className="tabular">{r.score === null ? "No data" : `${Math.round(r.score)} · ${r.grade}`}</span>
                </li>
              ))}
              {!sim.length && <li className="text-muted-foreground">Nobody to simulate yet.</li>}
            </ul>
          )}
          <DialogFooter>
            {editable && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(deleteTemplateDraft(t.id), "Draft deleted", true)}>
                Delete draft
              </Button>
            )}
            <Button
              type="button"
              variant="tertiary"
              disabled={busy}
              onClick={async () => {
                if (editable) {
                  const saved = await saveTemplateDraft(t.id, { name, kind: t.kind, description }, payload);
                  if (!saved.ok) return void toast.error(saved.error);
                }
                setBusy(true);
                const res = await simulateTemplateAction(t.id);
                setBusy(false);
                if (!res.ok) return void toast.error(res.error);
                setSim(res.data);
              }}
            >
              Simulate
            </Button>
            {editable && (
              <>
                <Button type="button" variant="tertiary" disabled={busy} onClick={() => void run(saveTemplateDraft(t.id, { name, kind: t.kind, description }, payload), "Draft saved")}>
                  Save draft
                </Button>
                <Button
                  type="button"
                  disabled={busy || !items.length}
                  onClick={async () => {
                    const saved = await saveTemplateDraft(t.id, { name, kind: t.kind, description }, payload);
                    if (!saved.ok) return void toast.error(saved.error);
                    await run(activateTemplate(t.id), "Activated — starts next month", true);
                  }}
                >
                  Activate
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
