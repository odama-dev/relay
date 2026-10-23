"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CURRENCIES, settingsFormSchema, type SettingsFormInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { CheckField } from "@/components/check-field";
import { saveSettings } from "./actions";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SettingsForm({
  initial,
  integrations,
}: {
  initial: SettingsFormInput;
  integrations: { slack: boolean; resend: boolean; xendit: boolean };
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SettingsFormInput>({ resolver: zodResolver(settingsFormSchema), defaultValues: initial });

  const onSubmit = handleSubmit(async (values) => {
    const res = await saveSettings(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Settings saved");
    reset(values);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      <FormSection title="Time log" description="Reminders run in Asia/Jakarta (WIB). Holidays aren't managed in Phase 1.">
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <FormField label="Reminder time" htmlFor="s-reminder" error={errors.reminder_time?.message}>
            <Input {...fieldA11y("s-reminder", errors.reminder_time?.message)} type="time" {...register("reminder_time")} />
          </FormField>
          <FormField label="Workdays" error={errors.workdays?.message}>
            <Controller
              control={control}
              name="workdays"
              render={({ field }) => (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                  {WEEKDAYS.map((d, i) => (
                    <CheckField
                      key={d}
                      id={`s-day-${i}`}
                      label={d}
                      checked={field.value.includes(i + 1)}
                      onChange={(on) => field.onChange(on ? [...field.value, i + 1] : field.value.filter((v) => v !== i + 1))}
                    />
                  ))}
                </div>
              )}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Budget alerts" description="Default thresholds for new projects. PMs can change them per project.">
        <Controller
          control={control}
          name="default_alert_thresholds"
          render={({ field }) => (
            <FormField
              label="Thresholds (%)"
              htmlFor="s-thresholds"
              error={errors.default_alert_thresholds?.message ?? errors.default_alert_thresholds?.[0]?.message}
              hint="Comma separated, e.g. 75, 100"
            >
              <Input
                id="s-thresholds"
                defaultValue={field.value.join(", ")}
                onChange={(e) =>
                  field.onChange(
                    e.target.value
                      .split(/[,\s]+/)
                      .filter(Boolean)
                      .map(Number),
                  )
                }
                className="max-w-60"
              />
            </FormField>
          )}
        />
      </FormSection>

      <FormSection title="Sales pipeline" description="An open deal is marked stale after this long in the same stage.">
        <FormField label="Stale after (days)" htmlFor="s-stale" error={errors.sales_stale_days?.message}>
          <Input {...fieldA11y("s-stale", errors.sales_stale_days?.message)} type="number" min={1} max={365} className="max-w-32" {...register("sales_stale_days", { valueAsNumber: true })} />
        </FormField>
      </FormSection>

      <FormSection title="Currencies" description="Clients may pay in another currency; the studio receives IDR.">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <FormField label="Active currencies" error={errors.currencies?.message}>
            <Controller
              control={control}
              name="currencies"
              render={({ field }) => (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                  {CURRENCIES.map((c) => (
                    <CheckField
                      key={c}
                      id={`s-cur-${c}`}
                      label={c}
                      checked={field.value.includes(c)}
                      onChange={(on) => field.onChange(on ? [...field.value, c] : field.value.filter((v) => v !== c))}
                    />
                  ))}
                </div>
              )}
            />
          </FormField>
          <FormField label="Base currency" htmlFor="s-base">
            <Controller
              control={control}
              name="base_currency"
              render={({ field }) => (
                <SelectField id="s-base" value={field.value} onChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              )}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Invoices" description="Used when invoices are issued and sent to clients.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Number format" htmlFor="s-format" error={errors.invoice_number_format?.message} hint="{YY} year, {SEQ} 4-digit sequence — ODAMA/{YY}/{SEQ}">
            <Input {...fieldA11y("s-format", errors.invoice_number_format?.message, true)} {...register("invoice_number_format")} />
          </FormField>
          <div />
          <FormField label="Sender name" htmlFor="s-sender-name" error={errors.invoice_sender_name?.message}>
            <Input {...fieldA11y("s-sender-name", errors.invoice_sender_name?.message)} {...register("invoice_sender_name")} />
          </FormField>
          <FormField label="Sender email" htmlFor="s-sender" error={errors.invoice_sender_email?.message} hint="Must be on a domain verified in Resend.">
            <Input {...fieldA11y("s-sender", errors.invoice_sender_email?.message, true)} type="email" {...register("invoice_sender_email")} />
          </FormField>
          <FormField label="Studio name" htmlFor="s-studio" error={errors.studio_name?.message}>
            <Input {...fieldA11y("s-studio", errors.studio_name?.message)} {...register("studio_name")} />
          </FormField>
          <FormField label="Studio website" htmlFor="s-web">
            <Input id="s-web" {...register("studio_website")} />
          </FormField>
          <FormField label="Studio email (on invoices)" htmlFor="s-studio-email">
            <Input id="s-studio-email" {...register("studio_email")} />
          </FormField>
          <div />
          <FormField label="Studio address" htmlFor="s-address" className="sm:col-span-2">
            <Textarea id="s-address" rows={2} {...register("studio_address")} />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Integrations" description="Configured on the server through environment variables.">
        <ul className="text-body">
          {(
            [
              ["Slack bot", integrations.slack, "SLACK_BOT_TOKEN"],
              ["Resend email", integrations.resend, "RESEND_API_KEY"],
              ["Xendit payments", integrations.xendit, "XENDIT_SECRET_KEY"],
            ] as const
          ).map(([name, on, envName]) => (
            <li key={name} className="flex items-center justify-between border-b border-divider py-2 last:border-0">
              <span>{name}</span>
              <span className={on ? "" : "text-muted-foreground"}>{on ? "Connected" : `Not configured (${envName})`}</span>
            </li>
          ))}
        </ul>
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
