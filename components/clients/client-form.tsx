"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { ClientDetail } from "@/lib/clients/queries";
import { CURRENCIES, clientSchema, type ClientInput, type ClientValues } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { TimezoneSelect } from "@/components/timezone-select";
import { RecordForm } from "@/components/record-panel";
import { createClient, updateClient } from "@/app/(app)/clients/actions";

const EMPTY: ClientInput = {
  code: "",
  name: "",
  country: "",
  timezone: "",
  defaultCurrency: "IDR",
  billingEmail: "",
  billingAddress: "",
  notes: "",
};

/**
 * Create or edit a client inside the client panel (`?client=new`, `&edit=1`).
 * The code prefixes every project code and is locked once the client has
 * projects. `onSaved` gets its id (a new client's panel opens on it).
 */
export function ClientForm({ client, onSaved, onCancel }: { client?: ClientDetail; onSaved: (id: string) => void; onCancel: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput, unknown, ClientValues>({
    resolver: zodResolver(clientSchema(client?.code)),
    defaultValues: client
      ? {
          code: client.code,
          name: client.name,
          country: client.country ?? "",
          timezone: client.timezone ?? "",
          defaultCurrency: client.defaultCurrency as ClientInput["defaultCurrency"],
          billingEmail: client.billingEmail ?? "",
          billingAddress: client.billingAddress ?? "",
          notes: client.notes ?? "",
        }
      : EMPTY,
  });

  const onSubmit = handleSubmit(async (values) => {
    if (client) {
      const res = await updateClient(client.id, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Client updated");
      onSaved(client.id);
    } else {
      const res = await createClient(values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Client created");
      onSaved(res.data.id);
    }
    router.refresh();
  });

  return (
    <RecordForm
      icon="clients"
      title={client ? `Edit ${client.name}` : "New client"}
      meta={<span className="truncate">{client ? <span className="tabular">{client.code}</span> : "The client code prefixes every project code, e.g. ACM-001."}</span>}
      onSubmit={onSubmit}
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <Button type="button" variant="tertiary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : client ? "Save" : "Add client"}
            </Button>
          </div>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 @sm:grid-cols-[120px_1fr]">
          <FormField
            label="Code"
            htmlFor="c-code"
            required
            error={errors.code?.message}
            hint={client?.codeLocked ? "Locked: the client has projects." : "2–3 letters, no numbers"}
          >
            <Input
              {...fieldA11y("c-code", errors.code?.message, true)}
              className="uppercase"
              maxLength={client && client.code.length > 3 ? client.code.length : 3}
              disabled={client?.codeLocked}
              placeholder="ACM"
              {...register("code")}
            />
          </FormField>
          <FormField label="Name" htmlFor="c-name" required error={errors.name?.message}>
            <Input {...fieldA11y("c-name", errors.name?.message)} autoComplete="organization" placeholder="e.g. Acme Corp" {...register("name")} />
          </FormField>
        </div>
        <div className="grid gap-4 @sm:grid-cols-2">
          <FormField label="Country" htmlFor="c-country">
            <Input id="c-country" {...register("country")} />
          </FormField>
          <FormField label="Currency" htmlFor="c-currency" required hint="Default for projects.">
            <Controller
              control={control}
              name="defaultCurrency"
              render={({ field }) => (
                <SelectField id="c-currency" value={field.value} onChange={field.onChange} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              )}
            />
          </FormField>
        </div>
        <FormField label="Time zone" htmlFor="c-tz" error={errors.timezone?.message}>
          <Controller
            control={control}
            name="timezone"
            render={({ field }) => <TimezoneSelect id="c-tz" value={field.value} onChange={field.onChange} noneLabel="Not set" />}
          />
        </FormField>
        <FormField label="Billing email" htmlFor="c-billing" error={errors.billingEmail?.message} hint="Invoices go here by default.">
          <Input {...fieldA11y("c-billing", errors.billingEmail?.message, true)} type="email" {...register("billingEmail")} />
        </FormField>
        <FormField label="Billing address" htmlFor="c-address" hint="Printed on invoices.">
          <Textarea id="c-address" rows={2} {...register("billingAddress")} />
        </FormField>
        <FormField label="Notes" htmlFor="c-notes">
          <Textarea id="c-notes" rows={3} {...register("notes")} />
        </FormField>
      </div>
    </RecordForm>
  );
}
