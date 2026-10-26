"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import type { Mailbox, MailView } from "@/lib/mail/queries";
import { formatRelative } from "@/lib/format";
import { suggestServers } from "@/lib/mail/pure";
import { composeMailSchema, mailAccountSchema, type ComposeMailInput, type MailAccountInput } from "@/lib/validation";
import { PageHeader } from "@/components/page-header";
import { PillButton } from "@/components/pill-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField, FormSection, fieldA11y } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/states";
import { icons } from "@/components/icon";
import { MailActivity } from "@/components/mail/mail-activity";
import { connectMailbox, disconnectMailbox, sendMailFrom, syncMailboxes, updateMailbox } from "./actions";

type Compose = {
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  accountId?: string;
};

/** Mail: your connected mailboxes, then everything sent and received through them. */
export function MailPage({
  mailboxes,
  messages,
  timeZone,
  filters,
}: {
  mailboxes: Mailbox[];
  messages: MailView[];
  timeZone: string;
  filters: React.ReactNode;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const [removing, setRemoving] = useState<Mailbox | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [syncing, setSyncing] = useState(false);
  const active = mailboxes.filter((m) => m.isActive);

  const sync = async (id?: string) => {
    setSyncing(true);
    const res = await syncMailboxes(id);
    setSyncing(false);
    if (!res.ok) return void toast.error(res.error);
    if (res.data.failed.length) toast.error(res.data.failed[0]!);
    else toast.success(res.data.added ? `${res.data.added} new message${res.data.added === 1 ? "" : "s"}` : "Up to date");
    router.refresh();
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Mail"
        compact
        actions={
          <>
            {active.length > 0 && (
              <Button variant="ghost" size="sm" leadingIcon={icons.refresh} disabled={syncing} onClick={() => void sync()}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
            <Button variant="ghost" size="sm" leadingIcon={icons.add} onClick={() => setConnecting(true)}>
              Connect mailbox
            </Button>
            {active.length > 0 && <PillButton onClick={() => setCompose({ to: "", cc: "", subject: "", text: "" })}>Compose</PillButton>}
          </>
        }
      />
      {mailboxes.length === 0 ? (
        <EmptyState
          icon="mail"
          title="Connect your mailbox"
          description="Any address on your own domain works over IMAP and SMTP. Mail you send and receive shows here and on the clients and people it's with."
          action={<PillButton onClick={() => setConnecting(true)}>Connect mailbox</PillButton>}
        />
      ) : (
        <>
          <ul className="bleed flex flex-col border-b">
            {mailboxes.map((m) => (
              <li key={m.id} className="flex min-h-12 items-center gap-3 border-b py-2 last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {m.displayName ? `${m.displayName} · ` : ""}
                    {m.email}
                  </span>
                  <span className={m.lastError ? "text-destructive truncate text-caption" : "text-muted-foreground truncate text-caption"}>
                    {m.lastError ?? (m.lastSyncedAt ? `Synced ${formatRelative(m.lastSyncedAt)}` : "Waiting for the first sync")}
                    {!m.lastError && (m.shared ? " · linked mail shared with Sales" : " · private")}
                  </span>
                </span>
                {!m.isActive ? <StatusBadge value="archived" label="Paused" /> : m.lastError ? <StatusBadge value="overdue" label="Needs attention" /> : null}
                <RowActions
                  label={`${m.email} actions`}
                  actions={[
                    {
                      label: "Sync now",
                      icon: "refresh",
                      hidden: !m.isActive,
                      onSelect: () => void sync(m.id),
                    },
                    {
                      label: "Settings",
                      icon: "settings",
                      onSelect: () => setEditing(m),
                    },
                    {
                      label: "Disconnect",
                      icon: "delete",
                      destructive: true,
                      onSelect: () => setRemoving(m),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
          <div className="bleed border-b py-2">{filters}</div>
          <div className="pt-4">
            <MailActivity
              messages={messages}
              timeZone={timeZone}
              emptyDescription="New mail appears after the next sync."
              onReply={(m) =>
                setCompose({
                  to: m.direction === "inbound" ? m.from.email : m.to.join(", "),
                  cc: "",
                  subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
                  text: "",
                  inReplyTo: m.messageId,
                  accountId: mailboxes.find((b) => b.email === m.account)?.id,
                })
              }
            />
          </div>
        </>
      )}
      {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
      {editing && <SettingsDialog mailbox={editing} onClose={() => setEditing(null)} />}
      {compose && <ComposeDialog mailboxes={active} initial={compose} onClose={() => setCompose(null)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Disconnect ${removing?.email ?? "this mailbox"}?`}
        description="The mail synced from it leaves the OS. Nothing changes in the mailbox itself — you can connect it again later."
        confirmLabel="Disconnect"
        cancelLabel="Keep it"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const res = await disconnectMailbox(removing.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          setRemoving(null);
          toast.success("Mailbox disconnected");
          router.refresh();
        }}
      />
    </div>
  );
}

type ConnectOutput = z.output<typeof mailAccountSchema>;

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<MailAccountInput, unknown, ConnectOutput>({
    resolver: zodResolver(mailAccountSchema),
    defaultValues: {
      email: "",
      displayName: "",
      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "",
      smtpPort: 465,
      smtpSecure: true,
      username: "",
      password: "",
      shared: true,
    },
  });
  const shared = useWatch({ control, name: "shared" });

  const onSubmit = handleSubmit(async (values) => {
    const res = await connectMailbox(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Mailbox connected — syncing the last 30 days");
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form onSubmit={onSubmit} noValidate className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Connect a mailbox</DialogTitle>
            <DialogDescription>
              Use the IMAP and SMTP details from your mail host. If it uses two-step sign-in, create an app password for Odama OS.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email address" htmlFor="mb-email" required error={errors.email?.message}>
              <Input
                {...register("email", {
                  onBlur: (e) => {
                    // Fill the usual hosts and the username once, from the address.
                    const email = String(e.target.value ?? "");
                    const s = suggestServers(email);
                    if (!getValues("imapHost")) setValue("imapHost", s.imapHost);
                    if (!getValues("smtpHost")) setValue("smtpHost", s.smtpHost);
                    if (!getValues("username")) setValue("username", email.trim());
                  },
                })}
                type="email"
                autoComplete="off"
                {...fieldA11y("mb-email", errors.email?.message)}
                placeholder="you@yourdomain.com"
              />
            </FormField>
            <FormField label="Name on outgoing mail" htmlFor="mb-name">
              <Input id="mb-name" {...register("displayName")} placeholder="e.g. Rafi from Odama" />
            </FormField>
          </div>
          <FormSection title="Incoming (IMAP)">
            <ServerFields prefix="imap" register={register} control={control} errors={errors} />
          </FormSection>
          <FormSection title="Outgoing (SMTP)">
            <ServerFields prefix="smtp" register={register} control={control} errors={errors} />
          </FormSection>
          <FormSection title="Sign-in">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Username" htmlFor="mb-user" required error={errors.username?.message}>
                <Input {...register("username")} autoComplete="off" {...fieldA11y("mb-user", errors.username?.message)} />
              </FormField>
              <FormField label="Password" htmlFor="mb-pass" required error={errors.password?.message} hint="Stored encrypted; never shown again.">
                <Input {...register("password")} type="password" autoComplete="new-password" {...fieldA11y("mb-pass", errors.password?.message)} />
              </FormField>
            </div>
          </FormSection>
          <Switch
            label="Share mail with clients and people with the Sales team"
            className="px-0"
            checked={shared}
            onToggle={() => setValue("shared", !shared)}
          />
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Checking…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServerFields({
  prefix,
  register,
  control,
  errors,
}: {
  prefix: "imap" | "smtp";
  register: ReturnType<typeof useForm<MailAccountInput, unknown, ConnectOutput>>["register"];
  control: ReturnType<typeof useForm<MailAccountInput, unknown, ConnectOutput>>["control"];
  errors: ReturnType<typeof useForm<MailAccountInput, unknown, ConnectOutput>>["formState"]["errors"];
}) {
  const hostKey = `${prefix}Host` as const;
  const portKey = `${prefix}Port` as const;
  const secureKey = `${prefix}Secure` as const;
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_96px_160px]">
      <FormField label="Server" htmlFor={`mb-${prefix}-host`} required error={errors[hostKey]?.message}>
        <Input
          {...register(hostKey)}
          autoComplete="off"
          {...fieldA11y(`mb-${prefix}-host`, errors[hostKey]?.message)}
          placeholder={`${prefix}.yourdomain.com`}
        />
      </FormField>
      <FormField label="Port" htmlFor={`mb-${prefix}-port`} required error={errors[portKey]?.message}>
        <Input type="number" {...register(portKey, { valueAsNumber: true })} {...fieldA11y(`mb-${prefix}-port`, errors[portKey]?.message)} />
      </FormField>
      <FormField label="Security" htmlFor={`mb-${prefix}-secure`}>
        <Controller
          control={control}
          name={secureKey}
          render={({ field }) => (
            <SelectField
              id={`mb-${prefix}-secure`}
              value={field.value ? "ssl" : "starttls"}
              onChange={(v) => field.onChange(v === "ssl")}
              options={[
                { value: "ssl", label: "SSL/TLS" },
                { value: "starttls", label: "STARTTLS" },
              ]}
            />
          )}
        />
      </FormField>
    </div>
  );
}

function SettingsDialog({ mailbox, onClose }: { mailbox: Mailbox; onClose: () => void }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(mailbox.displayName ?? "");
  const [shared, setShared] = useState(mailbox.shared);
  const [isActive, setIsActive] = useState(mailbox.isActive);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await updateMailbox(mailbox.id, {
      displayName,
      shared,
      isActive,
      password,
    });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Mailbox saved");
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{mailbox.email}</DialogTitle>
            <DialogDescription>
              IMAP {mailbox.imapHost}:{mailbox.imapPort} · SMTP {mailbox.smtpHost}:{mailbox.smtpPort}. To use another server, disconnect and connect again.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Name on outgoing mail" htmlFor="ms-name">
            <Input id="ms-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FormField>
          <FormField label="New password" htmlFor="ms-pass" hint="Only when it changed — the connection is checked again.">
            <Input id="ms-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <div className="flex flex-col">
            <Switch label="Share mail with clients and people with the Sales team" className="px-0" checked={shared} onToggle={() => setShared(!shared)} />
            <Switch label="Keep syncing this mailbox" className="px-0" checked={isActive} onToggle={() => setIsActive(!isActive)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ComposeOutput = z.output<typeof composeMailSchema>;

const splitAddresses = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);

function ComposeDialog({ mailboxes, initial, onClose }: { mailboxes: Mailbox[]; initial: Compose; onClose: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ComposeMailInput, unknown, ComposeOutput>({
    resolver: zodResolver(composeMailSchema),
    defaultValues: {
      accountId: initial.accountId ?? mailboxes[0]?.id ?? "",
      to: splitAddresses(initial.to),
      cc: [],
      subject: initial.subject,
      text: initial.text,
      inReplyTo: initial.inReplyTo ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await sendMailFrom(values);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Sent");
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{initial.inReplyTo ? "Reply" : "New email"}</DialogTitle>
            <DialogDescription>Sent from your own mailbox and kept here, linked to the client or person it&apos;s for.</DialogDescription>
          </DialogHeader>
          {mailboxes.length > 1 && (
            <FormField label="From" htmlFor="mc-from">
              <Controller
                control={control}
                name="accountId"
                render={({ field }) => (
                  <SelectField
                    id="mc-from"
                    value={field.value}
                    onChange={field.onChange}
                    options={mailboxes.map((m) => ({
                      value: m.id,
                      label: m.email,
                    }))}
                  />
                )}
              />
            </FormField>
          )}
          <FormField label="To" htmlFor="mc-to" required error={errors.to?.message ?? errors.to?.[0]?.message}>
            <Input
              id="mc-to"
              value={to}
              onChange={(e) => {
                // Typed as text; the schema checks the parsed list.
                setTo(e.target.value);
                setValue("to", splitAddresses(e.target.value));
              }}
              placeholder="name@company.com, another@company.com"
            />
          </FormField>
          <FormField label="Cc" htmlFor="mc-cc">
            <Input
              id="mc-cc"
              value={cc}
              onChange={(e) => {
                setCc(e.target.value);
                setValue("cc", splitAddresses(e.target.value));
              }}
            />
          </FormField>
          <FormField label="Subject" htmlFor="mc-subject" required error={errors.subject?.message}>
            <Input {...register("subject")} {...fieldA11y("mc-subject", errors.subject?.message)} />
          </FormField>
          <FormField label="Message" htmlFor="mc-text" required error={errors.text?.message}>
            <Textarea rows={10} {...register("text")} {...fieldA11y("mc-text", errors.text?.message)} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} leadingIcon={icons.send}>
              {isSubmitting ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
