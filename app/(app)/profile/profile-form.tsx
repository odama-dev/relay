"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ownProfileSchema, type OwnProfileInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormSection, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { updateOwnProfile } from "./actions";

export function ProfileForm({
  initial,
  email,
  slackLinked,
  timezones,
  notificationTypes,
}: {
  initial: OwnProfileInput;
  email: string;
  slackLinked: boolean;
  timezones: string[];
  notificationTypes: { value: string; label: string }[];
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<OwnProfileInput>({ resolver: zodResolver(ownProfileSchema), defaultValues: initial });

  const onSubmit = handleSubmit(async (values) => {
    const res = await updateOwnProfile(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Profile saved");
    reset(values);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      <FormSection title="You" description={email}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" htmlFor="pf-name" required error={errors.fullName?.message}>
            <Input {...fieldA11y("pf-name", errors.fullName?.message)} {...register("fullName")} />
          </FormField>
          <FormField label="Time zone" htmlFor="pf-tz" required hint="Times in the app are shown in this zone.">
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <SelectField id="pf-tz" value={field.value} onChange={field.onChange} options={timezones.map((t) => ({ value: t, label: t }))} />
              )}
            />
          </FormField>
          <FormField
            label="Avatar URL"
            htmlFor="pf-avatar"
            error={errors.avatarUrl?.message}
            hint="A link to a square image. Leave empty for the generated avatar."
            className="sm:col-span-2"
          >
            <Input {...fieldA11y("pf-avatar", errors.avatarUrl?.message, true)} type="url" placeholder="https://" {...register("avatarUrl")} />
          </FormField>
        </div>
      </FormSection>

      <FormSection
        title="Notifications"
        description={
          slackLinked
            ? "Sent as Slack DMs from the Odama bot, and kept in the bell inbox."
            : "You're not linked to Slack yet, so notifications only appear in the bell inbox. An admin can retry the link."
        }
      >
        <Controller
          control={control}
          name="mutedNotifications"
          render={({ field }) => {
            const muted = field.value ?? [];
            return (
              <div className="grid gap-3 sm:grid-cols-2">
                {notificationTypes.map((t) => (
                  <CheckField
                    key={t.value}
                    id={`pf-n-${t.value}`}
                    checked={!muted.includes(t.value)}
                    onChange={(on) => field.onChange(on ? muted.filter((m) => m !== t.value) : [...muted, t.value])}
                    label={t.label}
                  />
                ))}
              </div>
            );
          }}
        />
        <p className="text-muted-foreground text-caption">Approvals, payments and invoice notices can&apos;t be switched off.</p>
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
