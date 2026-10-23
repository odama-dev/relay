"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { AccessLevel, AppModule, Division } from "@prisma/client";
import { jobRoleSchema, type JobRoleInput } from "@/lib/validation";
import {
  ACCESS_LEVELS,
  APP_MODULES,
  DIVISIONS,
  LEVELS,
  accessLabel,
  divisionLabel,
  levelLabel,
  moduleLabel,
} from "@/lib/roles";
import { DataTable, type Column } from "@/components/data-table";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { PillButton } from "@/components/pill-button";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveJobRole, setJobRoleArchived } from "./actions";

type JobRole = {
  id: string;
  name: string;
  division: Division;
  level: number;
  defaultAccess: AccessLevel;
  defaultModules: AppModule[];
  hasOkr: boolean;
  archived: boolean;
  people: number;
};

/** Job roles (PRD Phase 2): the catalogue a person is assigned to; KPI templates attach here. */
export function JobRolesPanel({ roles }: { roles: JobRole[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<JobRole | "new" | null>(null);

  const columns: Column<JobRole>[] = [
    { id: "name", header: "Job role", sortValue: (r) => r.name.toLowerCase(), cell: (r) => r.name },
    { id: "division", header: "Division", sortValue: (r) => r.division, cell: (r) => divisionLabel(r.division) },
    { id: "level", header: "Level", sortValue: (r) => r.level, cell: (r) => levelLabel(r.level) },
    { id: "access", header: "Access", sortValue: (r) => r.defaultAccess, cell: (r) => accessLabel(r.defaultAccess) },
    {
      id: "modules",
      header: "Modules",
      cell: (r) => (r.defaultModules.length ? r.defaultModules.map(moduleLabel).join(", ") : <span className="text-muted-foreground">—</span>),
    },
    { id: "people", header: "People", className: "text-right tabular", sortValue: (r) => r.people, cell: (r) => r.people },
    {
      id: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.archived && <StatusBadge value="archived" />}
          <RowActions
            label={`Actions for ${r.name}`}
            actions={[
              { label: "Edit", icon: "edit", onSelect: () => setEditing(r) },
              {
                label: r.archived ? "Restore" : "Archive",
                icon: r.archived ? "restore" : "archive",
                onSelect: async () => {
                  const res = await setJobRoleArchived(r.id, !r.archived);
                  if (!res.ok) return void toast.error(res.error);
                  router.refresh();
                },
              },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted-foreground text-body">
          A job role sets a person&apos;s division and level, and suggests their access and modules. KPI templates are attached to job roles.
        </p>
        <PillButton icon="add" onClick={() => setEditing("new")}>
          Add job role
        </PillButton>
      </div>
      <div className="overflow-hidden rounded-lg border [--page-gutter:0px]">
        <DataTable
          columns={columns}
          rows={roles}
          getRowId={(r) => r.id}
          isRowInactive={(r) => r.archived}
          emptyTitle="No job roles yet"
          emptyDescription="Add the studio's job roles, or import them with the KPI Master seed."
        />
      </div>
      {editing && <JobRoleDialog role={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JobRoleDialog({ role, onClose }: { role: JobRole | null; onClose: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<JobRoleInput>({
    resolver: zodResolver(jobRoleSchema),
    defaultValues: role
      ? { name: role.name, division: role.division, level: role.level, defaultAccess: role.defaultAccess, defaultModules: role.defaultModules, hasOkr: role.hasOkr }
      : { name: "", division: "design", level: 1, defaultAccess: "member", defaultModules: [], hasOkr: false },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await saveJobRole(role?.id ?? null, values);
    if (!res.ok) return void toast.error(res.error);
    toast.success(role ? "Saved" : "Job role added");
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{role ? `Edit ${role.name}` : "Add job role"}</DialogTitle>
          </DialogHeader>
          <FormField label="Name" htmlFor="jr-name" required error={errors.name?.message}>
            <Input {...fieldA11y("jr-name", errors.name?.message)} {...register("name")} placeholder="e.g. Senior Staff Designer" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Division" htmlFor="jr-division" required>
              <Controller
                control={control}
                name="division"
                render={({ field }) => (
                  <SelectField id="jr-division" value={field.value} onChange={field.onChange} options={DIVISIONS.map((d) => ({ value: d, label: divisionLabel(d) }))} />
                )}
              />
            </FormField>
            <FormField label="Level" htmlFor="jr-level" required>
              <Controller
                control={control}
                name="level"
                render={({ field }) => (
                  <SelectField
                    id="jr-level"
                    value={String(field.value)}
                    onChange={(v) => field.onChange(Number(v))}
                    options={LEVELS.map((l) => ({ value: String(l), label: levelLabel(l) }))}
                  />
                )}
              />
            </FormField>
            <FormField label="Default access" htmlFor="jr-access" required>
              <Controller
                control={control}
                name="defaultAccess"
                render={({ field }) => (
                  <SelectField id="jr-access" value={field.value} onChange={field.onChange} options={ACCESS_LEVELS.map((a) => ({ value: a, label: accessLabel(a) }))} />
                )}
              />
            </FormField>
          </div>
          <Controller
            control={control}
            name="defaultModules"
            render={({ field }) => (
              <div className="grid gap-3 sm:grid-cols-2">
                {APP_MODULES.map((m) => (
                  <CheckField
                    key={m}
                    id={`jr-module-${m}`}
                    checked={field.value.includes(m)}
                    onChange={(on) => field.onChange(on ? [...field.value, m] : field.value.filter((x) => x !== m))}
                    label={moduleLabel(m)}
                  />
                ))}
              </div>
            )}
          />
          <Controller
            control={control}
            name="hasOkr"
            render={({ field }) => (
              <CheckField id="jr-okr" checked={field.value} onChange={field.onChange} label="Has OKRs" hint="People in this role set quarterly objectives." />
            )}
          />
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : role ? "Save changes" : "Add job role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
