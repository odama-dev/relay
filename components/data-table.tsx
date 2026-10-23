"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";

export type Column<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for client-side sorting. Omit to disable sorting on the column. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  /** The row's name (e.g. the project): set a step heavier than the other cells. */
  primary?: boolean;
  className?: string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  getRowHref?: (row: T) => string | undefined;
  /** Archived / deactivated rows: the only rows whose text is muted. */
  isRowInactive?: (row: T) => boolean;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyClassName?: string;
  /** "fixed" gives every column the same width, as in the Clients design. */
  layout?: "auto" | "fixed";
  /**
   * Detail under a row, opened from a chevron at the start of the first
   * column (e.g. what a person worked on today). Rows `isRowExpandable`
   * rejects get an empty slot, so the first column still lines up.
   */
  renderExpanded?: (row: T) => ReactNode;
  isRowExpandable?: (row: T) => boolean;
  /** The chevron's accessible name, e.g. "Show Ana's day". */
  expandLabel?: (row: T) => string;
  className?: string;
};

/**
 * One line per cell, always: a second fact gets its own column, never a
 * stacked line (cells don't wrap; the table scrolls sideways instead).
 * Cells: 12px sides, a hairline between columns (none after the last), body
 * text at Fluid's normal weight (the rows carry no hover index, so Fluid's
 * TableRow would otherwise set every row in the header's semibold).
 */
export const gridTableClass =
  "[&_:is(th,td)]:whitespace-nowrap [&_:is(th,td)]:px-3 [&_:is(th,td):not(:last-child)]:border-r [&_:is(th,td)]:border-border [&_td]:[font-variation-settings:'wght'_400,'opsz'_14]";

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  getRowHref,
  isRowInactive,
  pageSize = 25,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyClassName,
  layout = "auto",
  renderExpanded,
  isRowExpandable,
  expandLabel,
  className,
}: Props<T>) {
  const router = useRouter();
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (id: string) =>
    setSort((s) =>
      s?.id === id
        ? { id, dir: s.dir === "asc" ? "desc" : "asc" }
        : { id, dir: "asc" },
    );

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={emptyClassName} />;
  }

  return (
    // A grid on the page, no panel: one hairline under every row (header
    // included), hairlines between columns, the whole row tints on hover.
    // On the page it runs edge to edge (globals.css, [data-slot=data-table]).
    <div data-slot="data-table" className={cn("overflow-hidden", className)}>
      <div className="h-full overflow-auto">
        <Table className={cn(gridTableClass, layout === "fixed" && "table-fixed")}>
          <TableHeader>
            <TableRow className="border-border">
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  aria-sort={
                    sort?.id === col.id
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={cn(
                    "text-foreground h-8 py-0",
                    col.align === "right" && "text-right",
                    col.className,
                  )}
                >
                  {col.sortValue ? (
                    <button
                      onClick={() => toggleSort(col.id)}
                      className="hover:text-foreground inline-flex items-center gap-1 transition-colors duration-80"
                    >
                      {col.header}
                      {sort?.id === col.id && (
                        <Icon
                          name="chevronDown"
                          size={12}
                          className={cn(sort.dir === "asc" && "rotate-180")}
                        />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const href = getRowHref?.(row);
              const inactive = isRowInactive?.(row) ?? false;
              const id = getRowId(row);
              const canExpand = Boolean(renderExpanded) && (isRowExpandable?.(row) ?? true);
              const open = canExpand && expanded.has(id);
              return (
                <Fragment key={id}>
                  <TableRow
                    className={cn("border-border hover:bg-hover transition-colors duration-80", href && "cursor-pointer")}
                    onClick={href ? () => router.push(href) : undefined}
                  >
                    {columns.map((col, index) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          "h-9 py-0",
                          inactive ? "text-muted-foreground" : "text-foreground",
                          col.align === "right" && "tabular text-right",
                          col.primary && "[font-variation-settings:'wght'_500,'opsz'_14]!",
                          col.className,
                        )}
                      >
                        {renderExpanded && index === 0 ? (
                          <span className="flex min-w-0 items-center gap-1">
                            {canExpand ? (
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-label={expandLabel?.(row) ?? "Show details"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpanded(id);
                                }}
                                className="text-muted-foreground hover:text-foreground -ml-1 grid size-6 shrink-0 place-items-center rounded-md outline-none transition-colors duration-80 focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
                              >
                                <Icon name="chevronRight" size={14} className={cn("transition-transform duration-160", open && "rotate-90")} />
                              </button>
                            ) : (
                              <span className="-ml-1 size-6 shrink-0" aria-hidden />
                            )}
                            {col.cell(row)}
                          </span>
                        ) : (
                          col.cell(row)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                  {open && (
                    <TableRow className="border-border hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="whitespace-normal! p-0!">
                        {renderExpanded!(row)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div data-slot="data-table-pager" className="text-muted-foreground text-caption flex items-center justify-between px-3 py-2">
          <span>
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="compact"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
