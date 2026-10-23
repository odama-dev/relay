"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RaterKind } from "@prisma/client";
import type { Builder } from "@/lib/kpi/builder";
import { DataTable, type Column } from "@/components/data-table";
import { RowActions } from "@/components/row-actions";
import { PillButton } from "@/components/pill-button";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { PeoplePicker } from "@/components/people-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRatingForm, setFormRaters } from "@/app/(app)/performance/actions";

type Form = Builder["forms"][number];

const RATERS: { value: RaterKind; label: string }[] = [
  { value: "manager", label: "Direct manager" },
  { value: "self", label: "The person (self-assessment)" },
  { value: "project_peer", label: "Peers on the same project that week" },
  { value: "job_role", label: "A job role (e.g. Art Director)" },
  { value: "assigned", label: "Named raters" },
];

/** Rating forms for rating metrics: criteria with a 1–5 scale, who rates, how often. */
export function FormsPanel({ data }: { data: Builder }) {
  const [editing, setEditing] = useState<Form | "new" | null>(null);
  const [raters, setRaters] = useState<Form | null>(null);
  const columns: Column<Form>[] = [
    {
      id: "name",
      header: "Form",
      primary: true,
      cell: (f) => f.name,
      sortValue: (f) => f.name,
    },
    { id: "metric", header: "Metric", cell: (f) => f.metricName, sortValue: (f) => f.metricName },
    { id: "criteria", header: "Criteria", align: "right", cell: (f) => <span className="tabular">{f.criteria.length}</span>, sortValue: (f) => f.criteria.length },
    { id: "rater", header: "Rated by", cell: (f) => RATERS.find((r) => r.value === f.raterKind)?.label },
    { id: "freq", header: "How often", cell: (f) => (f.frequency === "weekly" ? "Weekly" : "Monthly") },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (f) => (
        <RowActions
          label={`Actions for ${f.name}`}
          actions={[
            { label: "Edit", icon: "edit", onSelect: () => setEditing(f) },
            { label: "Named raters", icon: "people", hidden: f.raterKind !== "assigned", onSelect: () => setRaters(f) },
          ]}
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
        <p className="text-muted-foreground text-caption">A comment is required for scores under 3. A period without a rater isn&apos;t counted.</p>
        <PillButton icon="add" onClick={() => setEditing("new")}>
          New form
        </PillButton>
      </div>
      <DataTable columns={columns} rows={data.forms} getRowId={(f) => f.id} emptyTitle="No rating forms yet" />
      {editing && <FormDialog form={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} />}
      {raters && <RatersDialog form={raters} people={data.people} onClose={() => setRaters(null)} />}
    </div>
  );
}

function FormDialog({ form, data, onClose }: { form: Form | null; data: Builder; onClose: () => void }) {
  const router = useRouter();
  const ratingMetrics = data.metrics.filter((m) => m.definition?.aggregation === "rating");
  const [name, setName] = useState(form?.name ?? "");
  const [metricId, setMetricId] = useState(form?.metricId ?? ratingMetrics[0]?.id ?? "");
  const [frequency, setFrequency] = useState(form?.frequency ?? "monthly");
  const [raterKind, setRaterKind] = useState<RaterKind>(form?.raterKind ?? "manager");
  const [raterJobRoleId, setJobRole] = useState(form?.raterJobRoleId ?? "");
  const [needsApproval, setApproval] = useState(form?.needsApproval ?? false);
  const [criteria, setCriteria] = useState(form?.criteria ?? [{ title: "", scale: ["", "", "", "", ""] }]);
  const setC = (i: number, patch: Partial<(typeof criteria)[number]>) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await saveRatingForm(form?.id ?? null, { metricId, name, frequency, raterKind, raterJobRoleId, needsApproval, criteria });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Form saved");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{form ? `Edit ${form.name}` : "New rating form"}</DialogTitle>
            <DialogDescription>The form feeds a rating metric: average ÷ 5 × 100.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="rf-name" required>
              <Input id="rf-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Metric" htmlFor="rf-metric" required hint="Rating metrics only.">
              <SelectField id="rf-metric" value={metricId} onChange={setMetricId} options={ratingMetrics.map((m) => ({ value: m.id, label: m.name }))} />
            </FormField>
            <FormField label="Rated by" htmlFor="rf-rater" required>
              <SelectField id="rf-rater" value={raterKind} onChange={(v) => setRaterKind(v as RaterKind)} options={RATERS} />
            </FormField>
            <FormField label="How often" htmlFor="rf-freq">
              <SelectField
                id="rf-freq"
                value={frequency}
                onChange={(v) => setFrequency(v as "weekly" | "monthly")}
                options={[
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </FormField>
            {raterKind === "job_role" && (
              <FormField label="Rating job role" htmlFor="rf-role" required>
                <SelectField id="rf-role" value={raterJobRoleId} onChange={setJobRole} placeholder="Pick a job role" options={data.jobRoles.map((r) => ({ value: r.id, label: r.name }))} />
              </FormField>
            )}
          </div>
          <CheckField id="rf-approval" checked={needsApproval} onChange={setApproval} label="HR approves each rating" hint="For self-assessments (Lead PM, Creative Director, Art Director)." />
          {criteria.map((c, i) => (
            <fieldset key={i} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input aria-label="Criterion" value={c.title} onChange={(e) => setC(i, { title: e.target.value })} placeholder="Criterion, e.g. Responsive & clear" />
                <Button type="button" variant="ghost" size="sm" disabled={criteria.length === 1} onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
              {c.scale.map((s, k) => (
                <Input key={k} aria-label={`Score ${k + 1}`} value={s} onChange={(e) => setC(i, { scale: c.scale.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={`${k + 1} — what it looks like`} />
              ))}
            </fieldset>
          ))}
          <div>
            <Button type="button" size="sm" variant="tertiary" onClick={() => setCriteria([...criteria, { title: "", scale: ["", "", "", "", ""] }])}>
              Add criterion
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !metricId}>
              Save form
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RatersDialog({ form, people, onClose }: { form: Form; people: Builder["people"]; onClose: () => void }) {
  const router = useRouter();
  const [subjectId, setSubject] = useState("");
  const [raterIds, setRaterIds] = useState<string[]>([]);
  const pick = (id: string) => {
    setSubject(id);
    setRaterIds(form.raters.filter((r) => r.subjectId === id).map((r) => r.raterId));
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await setFormRaters(form.id, { subjectId, raterIds });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Raters saved");
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>Named raters · {form.name}</DialogTitle>
            <DialogDescription>Who rates whom on this form — e.g. a junior&apos;s collaboration partners.</DialogDescription>
          </DialogHeader>
          <FormField label="Person rated" htmlFor="rr-subject" required>
            <SelectField id="rr-subject" value={subjectId} onChange={pick} placeholder="Pick a person" options={people.map((p) => ({ value: p.id, label: p.name }))} />
          </FormField>
          {subjectId && (
            <FormField label="Raters">
              <PeoplePicker people={people.filter((p) => p.id !== subjectId)} value={raterIds} onChange={setRaterIds} className="border" />
            </FormField>
          )}
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Done
            </Button>
            <Button type="submit" disabled={!subjectId}>
              Save raters
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
