"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { gridTableClass } from "@/components/data-table";
import { cn } from "@/lib/utils";

/**
 * Loading scaffolds that sit exactly where the real page parts land: the same
 * edge-to-edge rows, hairlines and heights as PageHeader (compact), FilterBar
 * and DataTable, so nothing jumps when the data arrives.
 */

/** Compact PageHeader: title on the left, the primary action pill on the right. */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="bleed flex min-h-12 items-center justify-between gap-3 border-b py-2">
      <Skeleton className="h-4 w-24" />
      {action && <Skeleton className="h-8 w-32 rounded-full" />}
    </div>
  );
}

/** FilterBar (toolbar): select pills on the left, the search field on the right. */
export function FilterBarSkeleton({ filters = 3, search = true }: { filters?: number; search?: boolean }) {
  const widths = ["w-32", "w-28", "w-24", "w-28", "w-24"];
  return (
    <div className="bleed flex flex-wrap items-center justify-between gap-[8px] border-b py-2">
      <div className="flex flex-wrap items-center gap-[8px]">
        {Array.from({ length: filters }).map((_, i) => (
          <Skeleton key={i} className={cn("h-8 rounded-full", widths[i % widths.length])} />
        ))}
      </div>
      {search && <Skeleton className="h-8 w-full rounded-full sm:w-[294px]" />}
    </div>
  );
}

/** DataTable: header row plus `rows` body rows; `primary` puts a status dot in the first column. */
export function DataTableSkeleton({
  cols = 5,
  rows = 8,
  primary = false,
}: {
  cols?: number;
  rows?: number;
  primary?: boolean;
}) {
  // Varied bar widths so the scaffold reads as text, not a grid of blocks.
  const cell = ["w-36", "w-20", "w-24", "w-28", "w-16", "w-24", "w-20"];
  return (
    <div data-slot="data-table" className="overflow-hidden" aria-busy aria-label="Loading">
      <Table className={gridTableClass}>
        <TableHeader>
          <TableRow className="border-border">
            {Array.from({ length: cols }).map((_, c) => (
              <TableHead key={c} className="h-9 py-0">
                <Skeleton className="h-3 w-14" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r} className="border-border">
              {Array.from({ length: cols }).map((_, c) => (
                <TableCell key={c} className="h-10 py-0">
                  <span className="flex items-center gap-2">
                    {primary && c === 0 && <Skeleton className="size-1.5 rounded-full" />}
                    <Skeleton className={cn("h-3.5", cell[(c + r) % cell.length])} />
                  </span>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Full PageHeader of a detail page: breadcrumb, title, meta line, actions; then the tab row. */
export function DetailHeaderSkeleton({ tabs = 4, actions = 2 }: { tabs?: number; actions?: number }) {
  return (
    <>
      <div className="flex flex-col gap-3 pt-8 pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col">
          <Skeleton className="mb-2 h-3 w-32" />
          <Skeleton className="h-6 w-64" />
          <div className="mt-3 flex items-center gap-3">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-56" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className={cn("h-8 rounded-full", i === 0 ? "w-28" : "w-8")} />
          ))}
        </div>
      </div>
      <div className="mt-6 flex gap-2 border-b pb-2">
        {Array.from({ length: tabs }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
    </>
  );
}
