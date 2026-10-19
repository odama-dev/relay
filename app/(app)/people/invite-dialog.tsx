"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { inviteSchema, type InviteInput } from "@/lib/validation";
import { EMPLOYMENT_TYPES, USER_ROLES, employmentLabel, roleLabel } from "@/lib/roles";
import { useOpenFromUrl } from "@/lib/hooks/use-open-from-url";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { PillButton } from "@/components/pill-button";
import { invitePerson } from "./actions";

/** After an invite: confirm, and offer the link when email isn't configured (dev). */
export function showInviteLink(link: string, emailed: boolean) {
  if (emailed) {
    toast.success("Invitation sent", { description: "The link is valid for 7 days." });
    return;
  }
  toast.warning("Invitation created, but the email wasn't sent", {
    description: "Copy the link and share it directly.",
    action: { label: "Copy link", onClick: () => void navigator.clipboard.writeText(link) },
    duration: 20_000,
  });
}

export function InviteButton({ canGrantAdmin }: { canGrantAdmin: boolean }) {
  const [open, setOpen] = useOpenFromUrl();
  return (
    <>
      <PillButton icon="invite" onClick={() => setOpen(true)}>
        Invite person
      </PillButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <InviteForm canGrantAdmin={canGrantAdmin} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function InviteForm({ canGrantAdmin, onDone }: { canGrantAdmin: boolean; onDone: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { fullName: "", email: "", role: "designer_dev", employmentType: "full_time", isAdmin: false },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await invitePerson(values);
    if (!res.ok) return void toast.error(res.error);
    showInviteLink(res.data.link, res.data.emailed);
    onDone();
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Invite person</DialogTitle>
        <DialogDescription>They get an email with a link to create their password. The link is valid for 7 days.</DialogDescription>
      </DialogHeader>
      <FormField label="Full name" htmlFor="inv-name" required error={errors.fullName?.message}>
        <Input {...fieldA11y("inv-name", errors.fullName?.message)} autoComplete="off" {...register("fullName")} />
      </FormField>
      <FormField label="Work email" htmlFor="inv-email" required error={errors.email?.message}>
        <Input {...fieldA11y("inv-email", errors.email?.message)} type="email" autoComplete="off" {...register("email")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Role" htmlFor="inv-role" required error={errors.role?.message}>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <SelectField
                {...fieldA11y("inv-role", errors.role?.message)}
                value={field.value}
                onChange={field.onChange}
                options={USER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
              />
            )}
          />
        </FormField>
        <FormField label="Employment" htmlFor="inv-employment" required error={errors.employmentType?.message}>
          <Controller
            control={control}
            name="employmentType"
            render={({ field }) => (
              <SelectField
                {...fieldA11y("inv-employment", errors.employmentType?.message)}
                value={field.value}
                onChange={field.onChange}
                options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: employmentLabel(t) }))}
              />
            )}
          />
        </FormField>
      </div>
      {canGrantAdmin && (
        <Controller
          control={control}
          name="isAdmin"
          render={({ field }) => (
            <CheckField
              id="inv-admin"
              checked={Boolean(field.value)}
              onChange={field.onChange}
              label="Admin access"
              hint="Admins manage settings, categories, Slack and CSV import."
            />
          )}
        />
      )}
      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Inviting…" : "Send invitation"}
        </Button>
      </DialogFooter>
    </form>
  );
}
