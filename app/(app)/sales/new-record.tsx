"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCompany, createPerson } from "./crm-actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { PillButton } from "@/components/pill-button";

/** "New company" / "New person": the few fields that start a record; the rest is edited in the table. */
export function NewRecordButton({ object, companies = [] }: { object: "company" | "person"; companies?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCompany = object === "company";

  const close = () => {
    setOpen(false);
    setName("");
    setExtra("");
    setCompanyId("");
    setError(null);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const res = isCompany ? await createCompany({ name, domain: extra }) : await createPerson({ name, email: extra, companyId });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(isCompany ? "Company added" : "Person added");
    close();
    router.refresh();
  };

  return (
    <>
      <PillButton onClick={() => setOpen(true)}>{isCompany ? "New company" : "New person"}</PillButton>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <DialogHeader>
              <DialogTitle>{isCompany ? "New company" : "New person"}</DialogTitle>
              <DialogDescription>
                {isCompany ? "A prospect or a client. People can be added to it later." : "A contact — at a company, or on their own."}
              </DialogDescription>
            </DialogHeader>
            <FormField label="Name" htmlFor="nr-name" required>
              <Input id="nr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={isCompany ? "e.g. Kopi Senja" : "e.g. Sari Wijaya"} />
            </FormField>
            <FormField label={isCompany ? "Domain" : "Email"} htmlFor="nr-extra">
              <Input id="nr-extra" type={isCompany ? "text" : "email"} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={isCompany ? "kopisenja.id" : "sari@kopisenja.id"} />
            </FormField>
            {!isCompany && (
              <FormField label="Company" htmlFor="nr-company">
                <SelectField id="nr-company" value={companyId} onChange={setCompanyId} noneLabel="No company" options={companies.map((c) => ({ value: c.id, label: c.name }))} />
              </FormField>
            )}
            {error && <p role="alert" className="text-destructive text-body">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="tertiary" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Adding…" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
