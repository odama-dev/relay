"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { PersonRow } from "@/lib/people/queries";
import { personAdminSchema, type PersonAdminInput } from "@/lib/validation";
import { EMPLOYMENT_TYPES, USER_ROLES, employmentLabel, roleLabel } from "@/lib/roles";
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
  open,
  onOpenChange,
}: {
  person: PersonRow;
  canGrantAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PersonAdminInput>({
    resolver: zodResolver(personAdminSchema),
    defaultValues: {
      fullName: person.fullName,
      role: person.role,
      employmentType: person.employmentType,
      isAdmin: person.isAdmin,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await updatePerson(person.id, values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Saved");
    onOpenChange(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
                hint={canGrantAdmin ? "Settings, categories, Slack and CSV import." : "Only an admin can change this."}
              />
            )}
          />
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
