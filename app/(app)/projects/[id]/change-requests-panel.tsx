"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { ChangeRequestRow } from "@/lib/health/change-requests";
import { formatDate, formatDuration, formatHours } from "@/lib/format";
import { markChangeRequestsBilled } from "../../approvals/actions";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icon";

/** M4.4 — approved out-of-scope work, grouped by task, to take to the client. */
export function ChangeRequestsPanel({
  projectId,
  rows,
  from,
  to,
  canMark,
}: {
  projectId: string;
  rows: ChangeRequestRow[];
  from?: string;
  to?: string;
  canMark: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, ChangeRequestRow[]>();
    for (const r of rows) map.set(r.taskTitle, [...(map.get(r.taskTitle) ?? []), r]);
    return [...map];
  }, [rows]);
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const unbilled = rows.filter((r) => !r.billedAt);

  const setRange = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "change-requests");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker aria-label="From" value={from ?? ""} onChange={(v) => setRange({ crfrom: v })} clearable placeholder="From" className="w-40" />
        <DatePicker aria-label="To" value={to ?? ""} onChange={(v) => setRange({ crto: v })} clearable placeholder="To" className="w-40" />
        <span className="text-muted-foreground text-body">
          <span className="tabular text-foreground">{formatHours(total)}</span> approved out of scope
        </span>
        <span className="flex-1" />
        {canMark && unbilled.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await markChangeRequestsBilled(unbilled.map((r) => r.id), true);
              setBusy(false);
              if (!res.ok) return void toast.error(res.error);
              toast.success("Marked as invoiced");
              router.refresh();
            }}
          >
            Mark {unbilled.length} as invoiced
          </Button>
        )}
        <Button variant="tertiary" size="sm" asChild>
          <a href={`/api/projects/${projectId}/change-requests${qs ? `?${qs}` : ""}`}>
            <Icon name="csv" size={14} />
            Export CSV
          </a>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="flag" title="No change requests" description="Out-of-scope work the PM approves shows up here, ready to discuss with the client." />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([task, items]) => (
            <section key={task} className="flex flex-col gap-1">
              <h3 className="flex items-baseline gap-2 px-1 text-body font-medium">
                {task}
                <span className="text-muted-foreground tabular text-caption">{formatHours(items.reduce((s, r) => s + r.minutes, 0))}</span>
              </h3>
              <ul className="flex flex-col divide-y divide-black/4 dark:divide-white/5">
                {items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-body">
                    <span className="tabular w-24">{formatDate(r.entryDate)}</span>
                    <span className="w-32 truncate">{r.person}</span>
                    <span className="tabular w-16">{formatDuration(r.minutes)}</span>
                    <span className="min-w-0 flex-1">{r.note}</span>
                    {r.billedAt && <StatusBadge value="paid" label="Invoiced" />}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
