"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { contactSchema, type ContactInput } from "@/lib/validation";
import type { ClientDetail } from "@/lib/clients/queries";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldA11y } from "@/components/form-field";
import { CheckField } from "@/components/check-field";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/states";
import { TextLink } from "@/components/text-link";
import { deleteContact, makePrimaryContact, saveContact } from "../actions";

type Contact = ClientDetail["contacts"][number];

export function ContactsPanel({ clientId, contacts, canEdit }: { clientId: string; contacts: Contact[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);

  const done = (res: { ok: boolean; error?: string }, msg?: string) => {
    if (!res.ok) return void toast.error(res.error);
    if (msg) toast.success(msg);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {contacts.length === 0 ? (
        <EmptyState
          icon="user"
          title="No contacts yet"
          description="The primary contact receives invoices together with the billing email."
          action={canEdit ? <Button variant="tertiary" onClick={() => setEditing("new")}>Add contact</Button> : null}
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
            {contacts.map((c) => (
              <li key={c.id} className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-1.5 text-body">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    {c.name}
                    {c.isPrimary && <StatusBadge value="sent" label="Primary" />}
                  </span>
                  <span className="text-muted-foreground truncate text-caption">
                    {[c.title, c.email].filter(Boolean).join(" · ") || "No email"}
                  </span>
                </span>
                {c.email && (
                  <TextLink href={`mailto:${c.email}`} muted className="hidden text-caption sm:inline">
                    Email
                  </TextLink>
                )}
                {canEdit && (
                  <RowActions
                    label={`Actions for ${c.name}`}
                    actions={[
                      { label: "Edit", icon: "edit", onSelect: () => setEditing(c) },
                      { label: "Make primary", icon: "star", hidden: c.isPrimary, onSelect: async () => done(await makePrimaryContact(clientId, c.id), "Primary contact set") },
                      { label: "Remove", icon: "delete", destructive: true, onSelect: async () => done(await deleteContact(clientId, c.id), "Contact removed") },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <Button variant="tertiary" size="sm" className="self-start" onClick={() => setEditing("new")}>
              Add contact
            </Button>
          )}
        </>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <ContactForm
              clientId={clientId}
              contact={editing === "new" ? undefined : editing}
              onDone={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactForm({ clientId, contact, onDone }: { clientId: string; contact?: Contact; onDone: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: contact?.name ?? "", email: contact?.email ?? "", title: contact?.title ?? "", isPrimary: contact?.isPrimary ?? false },
  });
  const onSubmit = handleSubmit(async (values) => {
    const res = await saveContact(clientId, contact?.id, values);
    if (!res.ok) return void toast.error(res.error);
    toast.success(contact ? "Contact updated" : "Contact added");
    onDone();
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
      </DialogHeader>
      <FormField label="Name" htmlFor="ct-name" required error={errors.name?.message}>
        <Input {...fieldA11y("ct-name", errors.name?.message)} {...register("name")} />
      </FormField>
      <FormField label="Email" htmlFor="ct-email" error={errors.email?.message}>
        <Input {...fieldA11y("ct-email", errors.email?.message)} type="email" {...register("email")} />
      </FormField>
      <FormField label="Title" htmlFor="ct-title">
        <Input id="ct-title" placeholder="Head of Marketing" {...register("title")} />
      </FormField>
      <Controller
        control={control}
        name="isPrimary"
        render={({ field }) => (
          <CheckField id="ct-primary" checked={Boolean(field.value)} onChange={field.onChange} label="Primary contact" hint="Receives invoices by default." />
        )}
      />
      <DialogFooter>
        <Button type="button" variant="tertiary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save contact"}</Button>
      </DialogFooter>
    </form>
  );
}
