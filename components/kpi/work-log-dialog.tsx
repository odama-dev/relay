"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { WorkLogKind } from "@prisma/client";
import { LOG_KINDS, WORK_LOG_KINDS } from "@/lib/kpi/logs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { DatePicker } from "@/components/date-picker";
import { AmountInput } from "@/components/amount-input";
import { PillButton } from "@/components/pill-button";
import { createWorkLog } from "@/app/(app)/work-log/actions";

type Option = { id: string; label: string };

/** Log a shot, idea, error… — with an optional evidence file. */
export function LogWorkButton({ today, viewerId, people, projects }: { today: string; viewerId: string; people: { id: string; name: string }[]; projects: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton icon="add" onClick={() => setOpen(true)}>
        Log work
      </PillButton>
      {open && <LogWorkDialog today={today} viewerId={viewerId} people={people} projects={projects} onClose={() => setOpen(false)} />}
    </>
  );
}

function LogWorkDialog({ today, viewerId, people, projects, onClose }: { today: string; viewerId: string; people: { id: string; name: string }[]; projects: Option[]; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<WorkLogKind>("shot");
  const [userId, setUserId] = useState(viewerId);
  const [projectId, setProjectId] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("");
  const [link, setLink] = useState("");
  const [value, setValue] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = LOG_KINDS[kind];

  const submit = async () => {
    setBusy(true);
    const res = await createWorkLog({ kind, userId, projectId, occurredOn, title, description, tag, link, value, total });
    if (!res.ok) {
      setBusy(false);
      return void toast.error(res.error);
    }
    if (file) {
      const body = new FormData();
      body.append("file", file);
      const up = await fetch(`/api/work-logs/${res.data.id}/evidence`, { method: "POST", body });
      if (!up.ok) toast.error((await up.json().catch(() => null))?.error ?? "Couldn't attach the file.");
    }
    setBusy(false);
    toast.success(`${cfg.label} logged`);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Log work</DialogTitle>
            <DialogDescription>{cfg.hint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="What" htmlFor="wl-kind" required>
              <SelectField
                id="wl-kind"
                value={kind}
                onChange={(v) => {
                  setKind(v as WorkLogKind);
                  setTag("");
                }}
                options={WORK_LOG_KINDS.map((k) => ({ value: k, label: LOG_KINDS[k].label }))}
              />
            </FormField>
            <FormField label="Whose work" htmlFor="wl-user" required hint={cfg.aboutOthers ? "Usually recorded by the PM or AD about someone." : undefined}>
              <SelectField id="wl-user" value={userId} onChange={setUserId} options={people.map((p) => ({ value: p.id, label: p.id === viewerId ? `${p.name} (me)` : p.name }))} />
            </FormField>
            <FormField label="Date" htmlFor="wl-date" required>
              <DatePicker id="wl-date" value={occurredOn} onChange={setOccurredOn} className="w-full" />
            </FormField>
            <FormField label="Project" htmlFor="wl-project" required={kind === "testimony"}>
              <SelectField id="wl-project" value={projectId} onChange={setProjectId} noneLabel="No project" options={projects.map((p) => ({ value: p.id, label: p.label }))} />
            </FormField>
          </div>
          <FormField label="Title" htmlFor="wl-title" required>
            <Input id="wl-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          {cfg.tags && (
            <FormField label="Category" htmlFor="wl-tag" required>
              <SelectField id="wl-tag" value={tag} onChange={setTag} placeholder="Pick one" options={cfg.tags.map((t) => ({ value: t.value, label: t.label }))} />
            </FormField>
          )}
          <FormField label={kind === "idea" ? "Problem, proposal and impact" : "Notes"} htmlFor="wl-desc" required={kind === "idea"}>
            <Textarea id="wl-desc" rows={kind === "idea" ? 5 : 3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "idea" ? "Problem: …\nProposal: …\nImpact: …" : undefined} />
          </FormField>
          {(cfg.value || cfg.total) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {cfg.value && (
                <FormField label={cfg.value} htmlFor="wl-value">
                  <AmountInput id="wl-value" value={value} onChange={setValue} placeholder="0" />
                </FormField>
              )}
              {cfg.total && (
                <FormField label={cfg.total} htmlFor="wl-total">
                  <AmountInput id="wl-total" value={total} onChange={setTotal} placeholder="0" />
                </FormField>
              )}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={cfg.linkLabel ?? "Link"} htmlFor="wl-link" required={cfg.linkRequired}>
              <Input id="wl-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
            </FormField>
            <FormField label="Evidence file" htmlFor="wl-file" hint="Screenshot or PDF, up to 10 MB.">
              <Input id="wl-file" type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Log it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
