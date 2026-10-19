"use client";

import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CURRENCIES, clientSchema, type ClientInput } from "@/lib/validation";
import { useOpenFromUrl } from "@/lib/hooks/use-open-from-url";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { PillButton } from "@/components/pill-button";
import { createClient, updateClient } from "./actions";

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

export function AddClientButton() {
  const [open, setOpen] = useOpenFromUrl();
  return (
    <>
      <PillButton onClick={() => setOpen(true)}>Add client</PillButton>
      <ClientFormDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: { id: string; values: ClientInput; codeLocked: boolean };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && <ClientForm client={client} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ClientForm({ client, onDone }: { client?: { id: string; values: ClientInput; codeLocked: boolean }; onDone: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput>({ resolver: zodResolver(clientSchema), defaultValues: client?.values ?? EMPTY });

  const onSubmit = handleSubmit(async (values) => {
    if (client) {
      const res = await updateClient(client.id, values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Client updated");
      onDone();
      router.refresh();
    } else {
      const res = await createClient(values);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Client created");
      onDone();
      router.push(`/clients/${res.data.id}`);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{client ? "Edit client" : "Add client"}</DialogTitle>
        <DialogDescription>The client code prefixes every project code, e.g. ACME-001.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <FormField
          label="Code"
          htmlFor="c-code"
          required
          error={errors.code?.message}
          hint={client?.codeLocked ? "Locked: the client has projects." : "2–6 letters"}
        >
          <Input
            {...fieldA11y("c-code", errors.code?.message, true)}
            className="uppercase"
            maxLength={6}
            disabled={client?.codeLocked}
            {...register("code")}
          />
        </FormField>
        <FormField label="Name" htmlFor="c-name" required error={errors.name?.message}>
          <Input {...fieldA11y("c-name", errors.name?.message)} autoComplete="organization" {...register("name")} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Country" htmlFor="c-country">
          <Input id="c-country" {...register("country")} />
        </FormField>
        <FormField label="Time zone" htmlFor="c-tz" error={errors.timezone?.message}>
          <Input id="c-tz" placeholder="Europe/London" {...register("timezone")} />
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
      <FormField label="Billing email" htmlFor="c-billing" error={errors.billingEmail?.message} hint="Invoices go here by default.">
        <Input {...fieldA11y("c-billing", errors.billingEmail?.message, true)} type="email" {...register("billingEmail")} />
      </FormField>
      <FormField label="Billing address" htmlFor="c-address" hint="Printed on invoices.">
        <Textarea id="c-address" rows={2} {...register("billingAddress")} />
      </FormField>
      <FormField label="Notes" htmlFor="c-notes">
        <Textarea id="c-notes" rows={2} {...register("notes")} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : client ? "Save changes" : "Create client"}
        </Button>
      </DialogFooter>
    </form>
  );
}
