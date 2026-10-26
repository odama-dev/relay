"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CrmColumn } from "@/lib/crm/queries";
import { CRM_TYPE_LABELS, valueSort, valueText, type CrmValue } from "@/lib/crm/pure";
import { archiveColumn, archiveRecords, moveColumn, setField } from "@/app/(app)/sales/crm-actions";
import { DataTable, type Column } from "@/components/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RowActions } from "@/components/row-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Icon, icons, type IconName } from "@/components/icon";
import { EditableCell, type CellKind } from "./cells";
import { ColumnDialog } from "./column-dialog";

export type RecordRow = { id: string; name: string; values: Record<string, CrmValue> };

/** A built-in column: a field on the record itself (name, email, company…). */
export type BuiltinColumn<R> = {
  key: string;
  header: string;
  icon: IconName;
  kind: CellKind;
  get: (row: R) => CrmValue;
  /** For `ref` columns: what can be picked. */
  refs?: { id: string; name: string }[];
  /** Read-only (e.g. a count); `render` draws it. */
  render?: (row: R) => ReactNode;
};

const TYPE_ICON: Record<CrmColumn["type"], IconName> = {
  text: "text",
  number: "numberedList",
  currency: "money",
  date: "calendar",
  checkbox: "check",
  select: "checklist",
  multi_select: "checklist",
  url: "link",
  email: "mail",
  phone: "phone",
};

/**
 * Companies / People as an Attio-style table: the name first, then the
 * built-in fields and the columns Sales added. Click a cell to edit it;
 * "Add column" adds a text, number, date, select, tag… column; select rows
 * to archive them. Read-only for Studio Report.
 */
export function RecordsTable<R extends RecordRow>({
  object,
  noun,
  rows,
  builtins,
  columns,
  canEdit,
  actions,
  onOpen,
  openId,
}: {
  object: "company" | "person";
  /** "company" / "person", for labels. */
  noun: string;
  rows: R[];
  builtins: BuiltinColumn<R>[];
  columns: CrmColumn[];
  canEdit: boolean;
  /** Right of the search (e.g. "New person"). */
  actions?: ReactNode;
  /** Opens a record's side panel: from its name, or a click on the row outside the editable cells. */
  onOpen?: (row: R) => void;
  /** The record whose panel is open, shown as selected. */
  openId?: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [columnDialog, setColumnDialog] = useState<{ column?: CrmColumn } | null>(null);
  const [archiveCol, setArchiveCol] = useState<CrmColumn | null>(null);
  const [archiving, setArchiving] = useState(false);

  const save = (id: string, key: string) => async (value: CrmValue) => {
    const res = await setField({ object, id, key, value });
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        builtins.some((b) => {
          const v = b.get(r);
          return typeof v === "string" && (b.refs?.find((x) => x.id === v)?.name ?? v).toLowerCase().includes(needle);
        }) ||
        columns.some((c) => valueText(c.type, c.options, r.values[c.id] ?? null).toLowerCase().includes(needle)),
    );
  }, [rows, q, builtins, columns]);

  const allOn = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const head = (icon: IconName, label: string) => (
    <span className="flex items-center gap-1.5">
      <Icon name={icon} size={14} className="text-muted-foreground shrink-0" />
      {label}
    </span>
  );

  const table: Column<R>[] = [
    ...(canEdit
      ? [
          {
            id: "select",
            header: (
              <Checkbox
                className="block"
                aria-label={`Select all ${noun === "company" ? "companies" : "people"}`}
                checked={allOn ? true : selected.size > 0 ? "indeterminate" : false}
                onCheckedChange={(on) => setSelected(on ? new Set(filtered.map((r) => r.id)) : new Set())}
              />
            ),
            cell: (r: R) => <Checkbox className="block" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onCheckedChange={(on) => toggle(r.id, on)} />,
            // Shrinks to the checkbox (the first cell also carries the page gutter).
            className: "w-px",
          },
        ]
      : []),
    {
      id: "name",
      header: head(object === "company" ? "clients" : "user", noun === "company" ? "Company" : "Person"),
      primary: true,
      sortValue: (r) => r.name.toLowerCase(),
      // With a panel, the name opens it (renaming moves into the panel's details).
      cell: (r) =>
        onOpen ? (
          <button type="button" className="block max-w-full truncate text-left hover:underline" onClick={() => onOpen(r)}>
            {r.name}
          </button>
        ) : (
          <EditableCell kind="text" value={r.name} editable={canEdit} label={`name of ${r.name}`} onSave={save(r.id, "name")} />
        ),
    },
    ...builtins.map(
      (b): Column<R> => ({
        id: b.key,
        header: head(b.icon, b.header),
        align: b.kind === "number" || b.kind === "currency" ? "right" : undefined,
        sortValue: (r) => {
          const v = b.get(r);
          if (v === null || v === undefined) return null;
          return b.refs ? (b.refs.find((x) => x.id === v)?.name ?? "").toLowerCase() : typeof v === "number" ? v : String(v).toLowerCase();
        },
        cell: (r) =>
          b.render ? b.render(r) : <EditableCell kind={b.kind} value={b.get(r)} refs={b.refs} editable={canEdit} label={`${b.header} of ${r.name}`} onSave={save(r.id, b.key)} />,
      }),
    ),
    ...columns.map(
      (c, i): Column<R> => ({
        id: c.id,
        header: <span title={CRM_TYPE_LABELS[c.type]}>{head(TYPE_ICON[c.type], c.name)}</span>,
        // Outside the sort button: a button can't hold another.
        headerAction: canEdit && (
          <RowActions
            label={`${c.name} column`}
            actions={[
              { label: "Edit column", icon: "edit", onSelect: () => setColumnDialog({ column: c }) },
              { label: "Move left", icon: "chevronLeft", hidden: i === 0, onSelect: () => void moveColumn(c.id, -1).then(() => router.refresh()) },
              { label: "Move right", icon: "chevronRight", hidden: i === columns.length - 1, onSelect: () => void moveColumn(c.id, 1).then(() => router.refresh()) },
              { label: "Remove column", icon: "archive", destructive: true, onSelect: () => setArchiveCol(c) },
            ]}
          />
        ),
        align: c.type === "number" || c.type === "currency" ? "right" : undefined,
        sortValue: (r) => valueSort(c.type, c.options, r.values[c.id] ?? null),
        cell: (r) => <EditableCell kind={c.type} value={r.values[c.id] ?? null} options={c.options} editable={canEdit} label={`${c.name} of ${r.name}`} onSave={save(r.id, c.id)} />,
      }),
    ),
    ...(canEdit
      ? [
          {
            id: "add",
            header: (
              <Button variant="ghost" size="compact" leadingIcon={icons.add} onClick={() => setColumnDialog({})}>
                Add column
              </Button>
            ),
            cell: () => null,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col">
      <div className="bleed flex min-h-12 flex-wrap items-center gap-2 border-b py-2">
        <div className="relative w-full max-w-72">
          <Icon name="search" size={14} className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
          <Input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun === "company" ? "companies" : "people"}`} className="pl-8" />
        </div>
        {selected.size > 0 && (
          <Button variant="secondary" size="sm" leadingIcon={icons.archive} onClick={() => setArchiving(true)}>
            Archive {selected.size}
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2">{actions}</span>
      </div>
      <DataTable
        columns={table}
        rows={filtered}
        getRowId={(r) => r.id}
        onRowClick={onOpen}
        isRowSelected={openId ? (r) => r.id === openId : undefined}
        pageSize={100}
        emptyTitle={q ? "Nothing matches" : `No ${noun === "company" ? "companies" : "people"} yet`}
        emptyDescription={q ? "Try another search." : `Add one with "New ${noun}".`}
      />
      <p className="text-muted-foreground bleed border-t py-2 text-caption">
        <span className="tabular">{filtered.length}</span> {filtered.length === 1 ? noun : noun === "company" ? "companies" : "people"}
        {q && ` of ${rows.length}`}
      </p>

      {columnDialog && <ColumnDialog object={object} column={columnDialog.column} onClose={() => setColumnDialog(null)} />}
      <ConfirmDialog
        open={archiveCol !== null}
        onOpenChange={(o) => !o && setArchiveCol(null)}
        title={`Remove ${archiveCol?.name ?? "column"}?`}
        description="The column disappears from the table. Values already entered are kept on the records."
        confirmLabel="Remove column"
        cancelLabel="Keep it"
        destructive
        onConfirm={async () => {
          const res = await archiveColumn(archiveCol!.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${selected.size} ${selected.size === 1 ? noun : noun === "company" ? "companies" : "people"}?`}
        description={object === "company" ? "They leave this list. Their people stay, without a company." : "They leave this list."}
        confirmLabel="Archive"
        cancelLabel="Keep them"
        destructive
        onConfirm={async () => {
          const res = await archiveRecords(object, [...selected]);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(`${res.data.count} archived`);
          setSelected(new Set());
          router.refresh();
        }}
      />
    </div>
  );
}
