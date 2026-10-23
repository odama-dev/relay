"use client";

import { useState, type ReactNode } from "react";
import type { CrmOption, CrmValue } from "@/lib/crm/pure";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/**
 * Cells of the Companies / People tables: how each type reads, and its
 * editor in a small popover (click the cell). Saving goes through
 * `onSave`, which returns an error message or null.
 */

export type CellKind = "text" | "longtext" | "number" | "currency" | "date" | "checkbox" | "select" | "multi_select" | "url" | "email" | "phone" | "ref";
type Save = (value: CrmValue) => Promise<string | null>;

const muted = <span className="text-muted-foreground">—</span>;

export function OptionBadge({ option }: { option: CrmOption }) {
  return (
    <Badge size="compact" variant="dot" color={option.color as BadgeColor}>
      {option.label}
    </Badge>
  );
}

/** The value as it reads in the table. */
export function CellValue({ kind, value, options = [], refs = [] }: { kind: CellKind; value: CrmValue; options?: CrmOption[]; refs?: { id: string; name: string }[] }) {
  // The checkbox root is an inline span: `block` gives it its size inside a table cell.
  if (kind === "checkbox") return <Checkbox className="block" checked={Boolean(value)} disabled aria-hidden />;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return muted;
  switch (kind) {
    case "number":
      return <span className="tabular block text-right">{formatNumber(value as number)}</span>;
    case "currency":
      return <span className="tabular block text-right">{formatMoney(value as number, "IDR")}</span>;
    case "date":
      return <span className="tabular">{formatDate(value as string)}</span>;
    case "select": {
      const o = options.find((x) => x.id === value);
      return o ? <OptionBadge option={o} /> : muted;
    }
    case "multi_select":
      return (
        <span className="flex gap-1 overflow-hidden">
          {(value as string[]).map((id) => {
            const o = options.find((x) => x.id === id);
            return o ? <OptionBadge key={id} option={o} /> : null;
          })}
        </span>
      );
    case "url":
      return (
        <a href={value as string} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[color:var(--link,#2563eb)] truncate hover:underline">
          {String(value).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
        </a>
      );
    case "email":
      return (
        <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} className="truncate hover:underline">
          {value as string}
        </a>
      );
    case "ref":
      return <span className="truncate">{refs.find((r) => r.id === value)?.name ?? "—"}</span>;
    default:
      return <span className="block max-w-72 truncate">{String(value)}</span>;
  }
}

/**
 * A cell you can edit: the value, and on click its editor. Read-only
 * viewers (Studio Report) just see the value.
 */
export function EditableCell({
  kind,
  value,
  options,
  refs,
  editable,
  label,
  onSave,
}: {
  kind: CellKind;
  value: CrmValue;
  options?: CrmOption[];
  refs?: { id: string; name: string }[];
  editable: boolean;
  label: string;
  onSave: Save;
}) {
  const [open, setOpen] = useState(false);
  const shown = <CellValue kind={kind} value={value} options={options} refs={refs} />;
  if (!editable) return shown;
  if (kind === "checkbox") {
    return <Checkbox className="block" checked={Boolean(value)} aria-label={label} onCheckedChange={(v) => void onSave(v)} />;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Edit ${label}`} className="-mx-1 block w-[calc(100%+0.5rem)] min-w-0 rounded px-1 text-left outline-none hover:bg-[var(--hover)] focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]">
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {open && <Editor kind={kind} value={value} options={options ?? []} refs={refs ?? []} label={label} onSave={onSave} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function Editor({
  kind,
  value,
  options,
  refs,
  label,
  onSave,
  onDone,
}: {
  kind: CellKind;
  value: CrmValue;
  options: CrmOption[];
  refs: { id: string; name: string }[];
  label: string;
  onSave: Save;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const commit = async (v: CrmValue, close = true) => {
    setBusy(true);
    const err = await onSave(v);
    setBusy(false);
    if (err) return setError(err);
    setError(null);
    if (close) onDone();
  };
  const err = error && <p className="text-destructive px-1 pt-1 text-caption">{error}</p>;

  if (kind === "select" || kind === "ref") {
    const items = kind === "select" ? options.map((o) => ({ id: o.id, text: o.label, node: <OptionBadge option={o} /> })) : refs.map((r) => ({ id: r.id, text: r.name, node: <span className="truncate">{r.name}</span> }));
    return (
      <PickList items={items} selected={value ? [value as string] : []} label={label} onPick={(id) => void commit(id === value ? null : id)} clearable={Boolean(value)} onClear={() => void commit(null)}>
        {err}
      </PickList>
    );
  }
  if (kind === "multi_select") {
    const current = (value as string[] | null) ?? [];
    return (
      <PickList
        items={options.map((o) => ({ id: o.id, text: o.label, node: <OptionBadge option={o} /> }))}
        selected={current}
        label={label}
        multi
        onPick={(id) => void commit(current.includes(id) ? current.filter((x) => x !== id) : [...current, id], false)}
        clearable={current.length > 0}
        onClear={() => void commit(null)}
      >
        {err}
      </PickList>
    );
  }
  return <TextEditor kind={kind} value={value} label={label} busy={busy} onCommit={(v) => void commit(v)} onCancel={onDone} error={err} />;
}

function TextEditor({
  kind,
  value,
  label,
  busy,
  onCommit,
  onCancel,
  error,
}: {
  kind: CellKind;
  value: CrmValue;
  label: string;
  busy: boolean;
  onCommit: (v: CrmValue) => void;
  onCancel: () => void;
  error: ReactNode;
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  const type = kind === "date" ? "date" : kind === "number" || kind === "currency" ? "number" : kind === "email" ? "email" : kind === "url" ? "url" : kind === "phone" ? "tel" : "text";
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (kind !== "longtext" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onCommit(text.trim() === "" ? null : text);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {kind === "longtext" ? (
        <Textarea aria-label={label} autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
      ) : (
        <Input aria-label={label} autoFocus type={type} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
      )}
      {error}
      <div className="flex justify-end gap-1">
        <Button size="compact" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="compact" disabled={busy} onClick={() => onCommit(text.trim() === "" ? null : text)}>
          Save
        </Button>
      </div>
    </div>
  );
}

function PickList({
  items,
  selected,
  label,
  multi = false,
  onPick,
  clearable,
  onClear,
  children,
}: {
  items: { id: string; text: string; node: ReactNode }[];
  selected: string[];
  label: string;
  multi?: boolean;
  onPick: (id: string) => void;
  clearable: boolean;
  onClear: () => void;
  children?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const shown = q ? items.filter((i) => i.text.toLowerCase().includes(q.toLowerCase())) : items;
  return (
    <div className="flex flex-col gap-1">
      {items.length > 7 && <Input aria-label={`Search ${label}`} autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <ul role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className="flex max-h-64 flex-col overflow-y-auto">
        {shown.map((i) => {
          const on = selected.includes(i.id);
          return (
            <li key={i.id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onPick(i.id)}
                className={cn("flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-[var(--hover)]", on && "bg-[var(--accent)]")}
              >
                <span className="min-w-0 flex-1">{i.node}</span>
                {on && <Icon name="check" size={14} className="shrink-0" />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="text-muted-foreground px-2 py-1.5 text-body">Nothing found.</li>}
      </ul>
      {children}
      {clearable && (
        <Button size="compact" variant="ghost" className="self-start" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
