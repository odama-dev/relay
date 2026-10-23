"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import type { JobRoleOption, PersonRow } from "@/lib/people/queries";
import { personAdminSchema, type PersonAdminInput } from "@/lib/validation";
import {
  ACCESS_LEVELS,
  APP_MODULES,
  DIVISIONS,
  EMPLOYMENT_TYPES,
  LEVELS,
  USER_ROLES,
  accessLabel,
  divisionLabel,
  employmentLabel,
  levelLabel,
  moduleHint,
  moduleLabel,
  roleLabel,
} from "@/lib/roles";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { updatePerson } from "./actions";

export function PersonDialog({
  person,
  canGrantAdmin,
  canManagePeopleModule,
  jobRoles,
  people,
  open,
  onOpenChange,
}: {
  person: PersonRow;
  canGrantAdmin: boolean;
  /** Job role, division, level, title and manager (People module). */
  canManagePeopleModule: boolean;
  jobRoles: JobRoleOption[];
  people: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<PersonAdminInput, unknown, z.output<typeof personAdminSchema>>({
    resolver: zodResolver(personAdminSchema),
    defaultValues: {
      fullName: person.fullName,
      role: person.role,
      employmentType: person.employmentType,
      isAdmin: person.isAdmin,
      jobRoleId: person.jobRoleId ?? "",
      division: person.division,
      level: person.level,
      jobTitle: person.jobTitle ?? "",
      managerId: person.managerId ?? "",
      accessLevel: person.accessLevel,
      modules: person.modules,
    },
  });

  // Picking a job role fills in its division, level and title, and — for an
  // admin — its default access and modules.
  const applyJobRole = (id: string) => {
    const jr = jobRoles.find((r) => r.id === id);
    if (!jr) return;
    setValue("division", jr.division);
    setValue("level", jr.level);
    if (!getValues("jobTitle")) setValue("jobTitle", jr.name);
    if (canGrantAdmin) {
      setValue("accessLevel", jr.defaultAccess);
      setValue("modules", jr.defaultModules);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    const res = await updatePerson(person.id, values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Saved");
    onOpenChange(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit {person.fullName}</DialogTitle>
            <DialogDescription>{person.email}</DialogDescription>
          </DialogHeader>
          <FormField label="Full name" htmlFor="p-name" required error={errors.fullName?.message}>
            <Input {...fieldA11y("p-name", errors.fullName?.message)} {...register("fullName")} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Role" htmlFor="p-role" required>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <SelectField
                    id="p-role"
                    value={field.value}
                    onChange={field.onChange}
                    options={USER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                  />
                )}
              />
            </FormField>
            <FormField label="Employment" htmlFor="p-employment" required>
              <Controller
                control={control}
                name="employmentType"
                render={({ field }) => (
                  <SelectField
                    id="p-employment"
                    value={field.value}
                    onChange={field.onChange}
                    options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: employmentLabel(t) }))}
                  />
                )}
              />
            </FormField>
          </div>
          <div className="grid gap-4 border-t pt-4">
            <p className="text-muted-foreground text-caption">
              {canManagePeopleModule ? "Job role, level and reporting line." : "Job role, level and reporting line are set by the People module."}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Job role" htmlFor="p-job-role">
                <Controller
                  control={control}
                  name="jobRoleId"
                  render={({ field }) => (
                    <SelectField
                      id="p-job-role"
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        applyJobRole(v);
                      }}
                      disabled={!canManagePeopleModule}
                      noneLabel="None"
                      options={jobRoles.map((r) => ({ value: r.id, label: r.name, hint: divisionLabel(r.division) }))}
                    />
                  )}
                />
              </FormField>
              <FormField label="Job title" htmlFor="p-title" error={errors.jobTitle?.message}>
                <Input
                  {...fieldA11y("p-title", errors.jobTitle?.message)}
                  {...register("jobTitle")}
                  disabled={!canManagePeopleModule}
                  placeholder="e.g. Art Director"
                />
              </FormField>
              <FormField label="Division" htmlFor="p-division">
                <Controller
                  control={control}
                  name="division"
                  render={({ field }) => (
                    <SelectField
                      id="p-division"
                      value={field.value}
                      onChange={(v) => field.onChange(v || null)}
                      disabled={!canManagePeopleModule}
                      noneLabel="None"
                      options={DIVISIONS.map((d) => ({ value: d, label: divisionLabel(d) }))}
                    />
                  )}
                />
              </FormField>
              <FormField label="Level" htmlFor="p-level">
                <Controller
                  control={control}
                  name="level"
                  render={({ field }) => (
                    <SelectField
                      id="p-level"
                      value={field.value ? String(field.value) : ""}
                      onChange={(v) => field.onChange(v ? Number(v) : null)}
                      disabled={!canManagePeopleModule}
                      noneLabel="None"
                      options={LEVELS.map((l) => ({ value: String(l), label: levelLabel(l) }))}
                    />
                  )}
                />
              </FormField>
            </div>
            <FormField label="Manager" htmlFor="p-manager">
              <Controller
                control={control}
                name="managerId"
                render={({ field }) => (
                  <SelectField
                    id="p-manager"
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!canManagePeopleModule}
                    noneLabel="No manager"
                    options={people.filter((p) => p.id !== person.id).map((p) => ({ value: p.id, label: p.name }))}
                  />
                )}
              />
            </FormField>
          </div>
          <div className="grid gap-4 border-t pt-4">
            <p className="text-muted-foreground text-caption">
              {canGrantAdmin ? "Access and modules decide what they can see and change." : "Only an admin can change access and modules."}
            </p>
            <Controller
              control={control}
              name="isAdmin"
              render={({ field }) => (
                <CheckField
                  id="p-admin"
                  checked={field.value}
                  onChange={field.onChange}
                  disabled={!canGrantAdmin}
                  label="Admin access"
                  hint="Everything, including settings, categories, Slack and CSV import."
                />
              )}
            />
            <FormField label="Access" htmlFor="p-access">
              <Controller
                control={control}
                name="accessLevel"
                render={({ field }) => (
                  <SelectField
                    id="p-access"
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!canGrantAdmin}
                    options={ACCESS_LEVELS.map((a) => ({
                      value: a,
                      label: accessLabel(a),
                      hint: a === "manager" ? "sees their reports' data" : "own data and projects",
                    }))}
                  />
                )}
              />
            </FormField>
            <Controller
              control={control}
              name="modules"
              render={({ field }) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  {APP_MODULES.map((m) => (
                    <CheckField
                      key={m}
                      id={`p-module-${m}`}
                      checked={field.value.includes(m)}
                      onChange={(on) => field.onChange(on ? [...field.value, m] : field.value.filter((x) => x !== m))}
                      disabled={!canGrantAdmin}
                      label={moduleLabel(m)}
                      hint={moduleHint(m)}
                    />
                  ))}
                </div>
              )}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
