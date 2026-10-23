"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CrmColumn } from "@/lib/crm/queries";
import { CRM_ATTRIBUTE_TYPES, CRM_TYPE_LABELS, OPTION_COLORS, newOptionId, type CrmAttributeType, type CrmOption, type OptionColor } from "@/lib/crm/pure";
import { createColumn, updateColumn } from "@/app/(app)/sales/crm-actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { badgeColors } from "@/components/ui/badge";
import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { Icon, icons } from "@/components/icon";
import { cn } from "@/lib/utils";

/**
 * Add a column to Companies or People, or edit one: its name and, for a
 * select, its options (each with a colour). A column's type is fixed once
 * created — values already written depend on it.
 */
export function ColumnDialog({ object, column, onClose }: { object: "company" | "person"; column?: CrmColumn; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(column?.name ?? "");
  const [type, setType] = useState<CrmAttributeType>(column?.type ?? "text");
  const [options, setOptions] = useState<CrmOption[]>(column?.options ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withOptions = type === "select" || type === "multi_select";

  const save = async () => {
    setBusy(true);
    setError(null);
    const clean = options.filter((o) => o.label.trim());
    const res = column ? await updateColumn(column.id, { name, options: clean }) : await createColumn({ object, name, type, options: clean });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(column ? "Column saved" : "Column added");
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{column ? `Edit ${column.name}` : "Add column"}</DialogTitle>
          <DialogDescription>{column ? `${CRM_TYPE_LABELS[column.type]} column.` : "Every record gets this column. Leave it empty where it doesn't apply."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Name" htmlFor="col-name" required>
            <Input id="col-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Industry, Last contacted, Tags" />
          </FormField>
          {!column && (
            <FormField label="Type" htmlFor="col-type">
              <SelectField id="col-type" value={type} onChange={(v) => setType(v as CrmAttributeType)} options={CRM_ATTRIBUTE_TYPES.map((t) => ({ value: t, label: CRM_TYPE_LABELS[t] }))} />
            </FormField>
          )}
          {withOptions && (
            <FormField label="Options">
              <ul className="flex flex-col gap-1.5">
                {options.map((o, i) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <ColorDots value={o.color} onChange={(color) => setOptions((l) => l.map((x, j) => (j === i ? { ...x, color } : x)))} />
                    <Input aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Button variant="ghost" size="icon-compact" aria-label={`Remove ${o.label || "option"}`} onClick={() => setOptions((l) => l.filter((_, j) => j !== i))}>
                      <Icon name="close" size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 self-start"
                leadingIcon={icons.add}
                onClick={() => setOptions((l) => [...l, { id: newOptionId(), label: "", color: OPTION_COLORS[l.length % OPTION_COLORS.length]! }])}
              >
                Add option
              </Button>
            </FormField>
          )}
          {error && <p role="alert" className="text-destructive text-body">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : column ? "Save" : "Add column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An option's colour: one dot per colour, the chosen one ringed. */
function ColorDots({ value, onChange }: { value: OptionColor; onChange: (c: OptionColor) => void }) {
  return (
    <span className="flex shrink-0 gap-1" role="radiogroup" aria-label="Colour">
      {OPTION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("size-3.5 rounded-full outline-offset-1", value === c && "outline-2 outline-[color:var(--foreground)]")}
          style={{ backgroundColor: badgeColors[c] }}
        />
      ))}
    </span>
  );
}
