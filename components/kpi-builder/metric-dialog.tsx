"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Builder } from "@/lib/kpi/builder";
import {
  AGGREGATIONS,
  AGGREGATION_LABELS,
  DIRECTIONS,
  DIRECTION_LABELS,
  METRIC_SOURCES,
  SOURCE_LABELS,
  explainMetric,
  metricDefinitionSchema,
  type MetricDefinition,
  type MetricFilters,
} from "@/lib/kpi/definition";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { AmountInput } from "@/components/amount-input";
import { previewMetricDefinition, saveMetric } from "@/app/(app)/performance/actions";

type Metric = Builder["metrics"][number];

const csv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const join = (xs?: string[]) => (xs ?? []).join(", ");

/** Statuses each source knows, as a hint for the filter. */
const STATUS_HINT: Partial<Record<string, string>> = {
  task: "approved, in_progress, review, todo, blocked",
  attendance: "present, remote, off, none",
  project: "active, on_hold, completed",
  review: "approved, changes_requested",
};

function FilterFields({ value, onChange, taskTypes, source, prefix }: { value: MetricFilters; onChange: (f: MetricFilters) => void; taskTypes: { key: string; name: string }[]; source: string; prefix: string }) {
  const set = (patch: Partial<MetricFilters>) => {
    const next = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof MetricFilters)[]) {
      const v = next[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k];
    }
    onChange(next);
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {source === "task" && (
        <FormField label="Task types" htmlFor={`${prefix}-types`} hint={taskTypes.map((t) => t.key).join(", ")}>
          <Input id={`${prefix}-types`} defaultValue={join(value.types)} onBlur={(e) => set({ types: csv(e.target.value) })} placeholder="e.g. content" />
        </FormField>
      )}
      <FormField label="Status" htmlFor={`${prefix}-status`} hint={STATUS_HINT[source] ?? "approved, submitted, rejected"}>
        <Input id={`${prefix}-status`} defaultValue={join(value.statuses)} onBlur={(e) => set({ statuses: csv(e.target.value) })} placeholder="Any" />
      </FormField>
      <FormField label="Tagged" htmlFor={`${prefix}-tags`}>
        <Input id={`${prefix}-tags`} defaultValue={join(value.tags)} onBlur={(e) => set({ tags: csv(e.target.value) })} placeholder="Any tag" />
      </FormField>
      <FormField label="Not tagged" htmlFor={`${prefix}-xtags`}>
        <Input id={`${prefix}-xtags`} defaultValue={join(value.excludeTags)} onBlur={(e) => set({ excludeTags: csv(e.target.value) })} placeholder="—" />
      </FormField>
      {(source === "task" || source === "review") && (
        <FormField label="On time" htmlFor={`${prefix}-ontime`}>
          <SelectField
            id={`${prefix}-ontime`}
            value={value.onTime === undefined ? "" : value.onTime ? "yes" : "no"}
            onChange={(v) => set({ onTime: v === "" ? undefined : v === "yes" })}
            noneLabel="Either"
            options={[
              { value: "yes", label: "On time" },
              { value: "no", label: "Late" },
            ]}
          />
        </FormField>
      )}
      {source === "project" && (
        <FormField label="Their projects" htmlFor={`${prefix}-prole`}>
          <SelectField
            id={`${prefix}-prole`}
            value={value.projectRole ?? ""}
            onChange={(v) => set({ projectRole: (v || undefined) as MetricFilters["projectRole"] })}
            noneLabel="Projects they run"
            options={[
              { value: "pm", label: "Projects they run" },
              { value: "member", label: "Projects they're on" },
            ]}
          />
        </FormField>
      )}
      <FormField label="Project kind" htmlFor={`${prefix}-pkind`}>
        <SelectField
          id={`${prefix}-pkind`}
          value={value.projectKinds?.length === 1 ? value.projectKinds[0]! : ""}
          onChange={(v) => set({ projectKinds: v ? [v as "client" | "internal"] : undefined })}
          noneLabel="Any project"
          options={[
            { value: "client", label: "Client projects" },
            { value: "internal", label: "Internal projects" },
          ]}
        />
      </FormField>
    </div>
  );
}

/**
 * PRD "Metrik": four questions — what to count, which rows, how, which way
 * is better — with the plain sentence and a preview from last month's data.
 */
export function MetricDialog({ metric, all, taskTypes, onClose }: { metric: Metric | null; all: Builder["metrics"]; taskTypes: { key: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(metric?.name ?? "");
  const [description, setDescription] = useState(metric?.description ?? "");
  const [unit, setUnit] = useState(metric?.unit ?? "");
  const [direction, setDirection] = useState<"higher" | "lower" | "record">(metric?.direction ?? "higher");
  const [manual, setManual] = useState(metric?.manual ?? false);
  const [def, setDef] = useState<MetricDefinition>(metric?.definition ?? { source: "task", scope: "self", filters: {}, aggregation: "count" });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<MetricDefinition>) => {
    setDef({ ...def, ...p });
    setPreview(null);
  };
  const parsed = metricDefinitionSchema.safeParse(def);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <form
          className="grid gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await saveMetric(metric?.id ?? null, { name, description, unit, direction, manual, definition: def });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success(metric ? "Metric saved" : "Metric added");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{metric ? `Edit ${metric.name}` : "New metric"}</DialogTitle>
            <DialogDescription>Scores already recorded keep the definition they were scored with.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="m-name" required>
              <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Unit" htmlFor="m-unit" hint="%, shots, per week…">
              <Input id="m-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </FormField>
          </div>

          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-body font-medium">1 · What do you want to count?</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Data" htmlFor="m-source" required>
                <SelectField id="m-source" value={def.source} onChange={(v) => patch({ source: v as MetricDefinition["source"], filters: {} })} options={METRIC_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} />
              </FormField>
              <FormField label="Whose" htmlFor="m-scope">
                <SelectField
                  id="m-scope"
                  value={def.scope}
                  onChange={(v) => patch({ scope: v as "self" | "team" })}
                  options={[
                    { value: "self", label: "The person's own" },
                    { value: "team", label: "Their team's (everyone reporting to them)" },
                  ]}
                />
              </FormField>
              {def.source === "task" && (
                <FormField label="Count tasks on" htmlFor="m-dateby">
                  <SelectField
                    id="m-dateby"
                    value={def.dateBy ?? "due"}
                    onChange={(v) => patch({ dateBy: v as "due" | "approved" })}
                    options={[
                      { value: "due", label: "Their (effective) due date" },
                      { value: "approved", label: "The day they were approved" },
                    ]}
                  />
                </FormField>
              )}
            </div>
            {def.source === "manual" && <p className="text-muted-foreground text-caption">Manual entries need evidence and show as “not automated yet”.</p>}
          </section>

          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-body font-medium">2 · Which ones?</h3>
            <FilterFields value={def.filters} onChange={(filters) => patch({ filters })} taskTypes={taskTypes} source={def.source} prefix="f" />
          </section>

          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-body font-medium">3 · How?</h3>
            <FormField label="Calculation" htmlFor="m-agg" required>
              <SelectField id="m-agg" value={def.aggregation} onChange={(v) => patch({ aggregation: v as MetricDefinition["aggregation"] })} options={AGGREGATIONS.map((a) => ({ value: a, label: AGGREGATION_LABELS[a] }))} />
            </FormField>
            {def.aggregation === "percent" && (
              <>
                <p className="text-muted-foreground text-caption">The part: rows that also match…</p>
                <FilterFields value={def.part ?? {}} onChange={(part) => patch({ part })} taskTypes={taskTypes} source={def.source} prefix="p" />
                <CheckField id="m-weekly" checked={Boolean(def.weekly)} onChange={(weekly) => patch({ weekly })} label="Score each week, then average the weeks" />
              </>
            )}
            {def.aggregation === "average" && (
              <FormField label="Average of" htmlFor="m-per">
                <SelectField
                  id="m-per"
                  value={def.per ?? "value"}
                  onChange={(v) => patch({ per: v as "value" | "week" | "group" })}
                  options={[
                    { value: "value", label: "Each row's value" },
                    { value: "week", label: "Rows per week" },
                    { value: "group", label: "Rows per deliverable" },
                  ]}
                />
              </FormField>
            )}
            {(def.aggregation === "count" || (def.aggregation === "average" && def.per === "group")) && (
              <CheckField id="m-weeks" checked={Boolean(def.distinctWeeks)} onChange={(distinctWeeks) => patch({ distinctWeeks })} label="Count weeks, not rows" hint="Several rows in one week count once — e.g. client feedback rounds." />
            )}
            {def.aggregation === "composite" && (
              <Components value={def.components ?? []} onChange={(components) => patch({ components })} metrics={all.filter((m) => m.id !== metric?.id)} />
            )}
          </section>

          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-body font-medium">4 · Which way is better?</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Direction" htmlFor="m-dir" required>
                <SelectField id="m-dir" value={direction} onChange={(v) => setDirection(v as typeof direction)} options={DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABELS[d] }))} />
              </FormField>
              <CheckField id="m-manual" checked={manual || def.source === "manual"} onChange={setManual} label="Not automated yet" hint="Entered by hand with evidence until the OS has the data." />
            </div>
            <FormField label="Notes for people" htmlFor="m-desc">
              <Textarea id="m-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
          </section>

          <section className="bg-hover grid gap-2 rounded-lg p-3">
            <p className="text-body">{parsed.success ? explainMetric(parsed.data) : (parsed.error.issues[0]?.message ?? "Finish the definition")}</p>
            {preview && <p className="text-muted-foreground text-caption">{preview}</p>}
            <div>
              <Button
                type="button"
                size="sm"
                variant="tertiary"
                disabled={!parsed.success}
                onClick={async () => {
                  const res = await previewMetricDefinition(def);
                  if (!res.ok) return void toast.error(res.error);
                  const r = res.data;
                  setPreview(
                    r.withData
                      ? `Last month: ${r.withData} of ${r.people} people have data · average ${r.average}${unit === "%" ? "%" : ""} · range ${r.min}–${r.max}`
                      : `Last month: no data for any of the ${r.people} people yet.`,
                  );
                }}
              >
                Preview with last month&apos;s data
              </Button>
            </div>
          </section>

          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !parsed.success}>
              {metric ? "Save metric" : "Add metric"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Component = NonNullable<MetricDefinition["components"]>[number];

function Components({ value, onChange, metrics }: { value: Component[]; onChange: (c: Component[]) => void; metrics: Builder["metrics"] }) {
  const set = (i: number, patch: Partial<Component>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="grid gap-2">
      {value.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_5rem_8rem_auto] items-end gap-2">
          <SelectField aria-label="Metric" value={c.metricKey} onChange={(v) => set(i, { metricKey: v })} options={metrics.map((m) => ({ value: m.key, label: m.name }))} />
          <AmountInput aria-label="Weight %" value={c.weight} onChange={(v) => set(i, { weight: v ?? 0 })} placeholder="Weight" />
          <AmountInput aria-label="Target" value={c.target} onChange={(v) => set(i, { target: v })} placeholder="Target" />
          <SelectField aria-label="Direction" value={c.direction} onChange={(v) => set(i, { direction: v as Component["direction"] })} options={DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABELS[d] }))} />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="tertiary" onClick={() => onChange([...value, { metricKey: metrics[0]?.key ?? "", weight: 20, target: null, direction: "higher" }])}>
          Add a metric
        </Button>
      </div>
    </div>
  );
}
