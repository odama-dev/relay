"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Builder } from "@/lib/kpi/builder";
import { divisionLabel, levelLabel } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { RowActions } from "@/components/row-actions";
import { PillButton } from "@/components/pill-button";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { PeoplePicker } from "@/components/people-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { addPersonAssignment, endAssignment, setRoleTemplates } from "@/app/(app)/performance/actions";

type Role = Builder["jobRoles"][number];

/** Templates attach to job roles (core + add-ons) and can be overridden per person; changes start next month. */
export function AssignmentsPanel({ data }: { data: Builder }) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [adding, setAdding] = useState(false);
  const nameOf = (lineageId: string) => data.templates.find((t) => t.lineageId === lineageId)?.name ?? "—";
  const columns: Column<Role>[] = [
    {
      id: "role",
      header: "Job role",
      primary: true,
      cell: (r) => r.name,
      sortValue: (r) => r.name,
    },
    { id: "division", header: "Division", cell: (r) => divisionLabel(r.division), sortValue: (r) => r.division },
    { id: "level", header: "Level", cell: (r) => levelLabel(r.level), sortValue: (r) => r.level },
    { id: "people", header: "People", align: "right", cell: (r) => <span className="tabular">{r.people}</span>, sortValue: (r) => r.people },
    { id: "core", header: "Core", cell: (r) => (r.core.length ? r.core.map(nameOf).join(", ") : <span className="text-muted-foreground">No KPI (empty state)</span>) },
    { id: "addons", header: "Add-ons", cell: (r) => r.addons.map(nameOf).join(", ") || "—" },
    { id: "actions", header: "", className: "w-12 text-right", cell: (r) => <RowActions label={`Actions for ${r.name}`} actions={[{ label: "Set templates", icon: "edit", onSelect: () => setRole(r) }]} /> },
  ];
  type Override = Builder["personAssignments"][number];
  const overrideColumns: Column<Override>[] = [
    { id: "person", header: "Person", primary: true, cell: (a) => a.person, sortValue: (a) => a.person },
    { id: "template", header: "Template", cell: (a) => nameOf(a.lineageId) },
    { id: "kind", header: "As", cell: (a) => (a.kind === "core" ? "Core (replaces the role's)" : "Add-on") },
    { id: "from", header: "From", cell: (a) => <span className="tabular">{formatDate(a.startsOn)}</span> },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (a) => (
        <RowActions
          label="Override actions"
          actions={[
            {
              label: "End",
              icon: "close",
              onSelect: async () => {
                const res = await endAssignment(a.id);
                if (!res.ok) return void toast.error(res.error);
                router.refresh();
              },
            },
          ]}
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <DataTable columns={columns} rows={data.jobRoles} getRowId={(r) => r.id} emptyTitle="No job roles yet" emptyDescription="Add them in People Setup." />
      <div className="bleed mt-6 flex min-h-12 items-center justify-between gap-3 border-y py-2">
        <h3 className="text-body font-medium">Per-person overrides</h3>
        <PillButton icon="add" onClick={() => setAdding(true)}>
          Add override
        </PillButton>
      </div>
      <DataTable columns={overrideColumns} rows={data.personAssignments} getRowId={(a) => a.id} emptyTitle="No overrides" emptyDescription="Everyone follows their job role." />
      {role && <RoleDialog role={role} templates={data.templates} onClose={() => setRole(null)} />}
      {adding && <OverrideDialog data={data} onClose={() => setAdding(false)} />}
    </div>
  );
}

function RoleDialog({ role, templates, onClose }: { role: Role; templates: Builder["templates"]; onClose: () => void }) {
  const router = useRouter();
  const [core, setCore] = useState(role.core);
  const [addons, setAddons] = useState(role.addons);
  const opt = (kind: "core" | "addon") => templates.filter((t) => t.kind === kind && t.live).map((t) => ({ id: t.lineageId, name: t.name, avatarUrl: null }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await setRoleTemplates(role.id, { core, addons });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Saved — applies from next month");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{role.name}</DialogTitle>
            <DialogDescription>Only live templates can be attached. The change applies from the 1st of next month.</DialogDescription>
          </DialogHeader>
          <FormField label="Core">
            <PeoplePicker people={opt("core")} value={core} onChange={setCore} className="border" placeholder="Add a core template" />
          </FormField>
          <FormField label="Add-ons">
            <PeoplePicker people={opt("addon")} value={addons} onChange={setAddons} className="border" placeholder="Add add-ons" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OverrideDialog({ data, onClose }: { data: Builder; onClose: () => void }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [lineageId, setLineageId] = useState("");
  const [kind, setKind] = useState<"core" | "addon">("addon");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await addPersonAssignment({ userId, lineageId, kind });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Override added — applies from next month");
            onClose();
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>Per-person override</DialogTitle>
            <DialogDescription>A core override replaces the job role&apos;s core templates for this person; an add-on comes on top.</DialogDescription>
          </DialogHeader>
          <FormField label="Person" htmlFor="ov-person" required>
            <SelectField id="ov-person" value={userId} onChange={setUserId} placeholder="Pick a person" options={data.people.map((p) => ({ value: p.id, label: p.name }))} />
          </FormField>
          <FormField label="Template" htmlFor="ov-template" required>
            <SelectField id="ov-template" value={lineageId} onChange={setLineageId} placeholder="Pick a template" options={data.templates.filter((t) => t.live).map((t) => ({ value: t.lineageId, label: t.name }))} />
          </FormField>
          <FormField label="As" htmlFor="ov-kind">
            <SelectField
              id="ov-kind"
              value={kind}
              onChange={(v) => setKind(v as "core" | "addon")}
              options={[
                { value: "addon", label: "Add-on" },
                { value: "core", label: "Core (replaces the role's)" },
              ]}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!userId || !lineageId}>
              Add override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
