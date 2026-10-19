"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComplianceRow } from "@/lib/time/compliance";
import { addDays, weekStart } from "@/lib/time/pure";
import { formatDate, formatHours, formatWeekday } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Icon, icons } from "@/components/icon";
import { EmptyState } from "@/components/states";
import { gridTableClass } from "@/components/data-table";
import { cn } from "@/lib/utils";

export function ComplianceView({
  data,
  today,
  role,
  filters,
}: {
  data: { weekStart: string; days: string[]; rows: ComplianceRow[] };
  today: string;
  role?: string;
  /** Filter controls shown beside Export CSV (the page's role filter). */
  filters?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q")?.toLowerCase() ?? "";
  const rows = q ? data.rows.filter((r) => r.name.toLowerCase().includes(q)) : data.rows;
  const go = (week: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("week", week);
    router.push(`${pathname}?${next.toString()}`);
  };
  const exportQs = new URLSearchParams({ week: data.weekStart, ...(role ? { role } : {}) }).toString();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => go(addDays(data.weekStart, -7))}>
          <Icon name="chevronLeft" size={16} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next week" disabled={data.weekStart >= weekStart(today)} onClick={() => go(addDays(data.weekStart, 7))}>
          <Icon name="chevronRight" size={16} />
        </Button>
        <h2 className="text-title font-medium">
          Week of {formatDate(data.weekStart)}
        </h2>
        <span className="text-muted-foreground text-body">
          · {rows.filter((r) => r.missingDays > 0).length} of {rows.length} people with empty workdays
        </span>
        <span className="flex-1" />
        {filters}
        <Button variant="tertiary" size="sm" asChild leadingIcon={icons.csv}>
          <a href={`/api/compliance?${exportQs}`}>Export CSV
          </a>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="people" title="No one to show" />
      ) : (
        <div data-slot="data-table" className="overflow-x-auto">
          <table className={cn(gridTableClass, "w-full min-w-[640px] border-collapse text-body")}>
            <thead>
              <tr className="border-border border-y">
                <th className="text-foreground h-9 text-left font-medium">
                  Person
                </th>
                <th className="text-foreground h-9 text-left font-medium">Role</th>
                {data.days.map((d) => (
                  <th key={d} className="text-foreground h-9 text-center font-medium">
                    {formatWeekday(d).split(",")[0]}
                  </th>
                ))}
                <th className="text-foreground h-9 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-border hover:bg-hover border-b transition-colors duration-80">
                  <td className="text-foreground h-10">{r.name}</td>
                  <td className="h-10">{roleLabel(r.role)}</td>
                  {r.days.map((d) => (
                    <td
                      key={d.date}
                      className={cn(
                        "tabular h-10 text-center",
                        d.missing && "text-warning",
                      )}
                    >
                      {d.minutes ? formatHours(d.minutes) : d.missing ? "Empty" : "—"}
                    </td>
                  ))}
                  <td className="tabular text-foreground h-10 text-right">{formatHours(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
