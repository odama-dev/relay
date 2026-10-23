"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PmProject } from "@/lib/dashboard/queries";
import { addDays, weekStart, type IsoDate } from "@/lib/time/pure";
import { formatDateShort } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { CalendarHeader, Dot } from "@/components/calendar/month-grid";
import { projectHue } from "@/components/calendar/project-hue";
import { cn } from "@/lib/utils";

const WEEKS = 12;

const days = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * PRD Phase 2 "tab Timeline": the projects you run as bars across twelve
 * weeks — the project's colour on the bar, where it stands as a separate
 * badge (colour never doubles as status). `?from=` moves the window.
 */
export function PmTimeline({ today, projects, from, switcher }: { today: IsoDate; projects: PmProject[]; from: IsoDate; switcher?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const startDay = weekStart(from);
  const endDay = addDays(startDay, WEEKS * 7 - 1);
  const total = WEEKS * 7;
  const go = (d: IsoDate) => {
    const next = new URLSearchParams(params.toString());
    if (weekStart(d) === weekStart(addDays(today, -14))) next.delete("from");
    else next.set("from", weekStart(d));
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const rows = projects.filter((p) => p.startDate <= endDay && (p.endDate ?? endDay) >= startDay);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(startDay, i * 7));
  const todayLeft = today >= startDay && today <= endDay ? (days(startDay, today) / total) * 100 : null;

  return (
    <section aria-label="Project timeline" className="flex min-w-0 flex-col">
      <CalendarHeader
        title={`${formatDateShort(startDay)} – ${formatDateShort(endDay)}`}
        pending={pending}
        unit="week"
        onToday={() => go(addDays(today, -14))}
        onStep={(n) => go(addDays(startDay, n * 28))}
      >
        {switcher}
      </CalendarHeader>
      <div className={cn("overflow-x-auto border-t transition-opacity", pending && "opacity-60")}>
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[200px_1fr] border-b">
            <span className="text-muted-foreground px-[var(--page-gutter,1rem)] py-2 text-caption">Project</span>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
              {weeks.map((w) => (
                <span key={w} className="text-muted-foreground tabular border-l px-1.5 py-2 text-caption">
                  {formatDateShort(w)}
                </span>
              ))}
            </div>
          </div>
          {rows.length === 0 && <p className="text-muted-foreground px-[var(--page-gutter,1rem)] py-6 text-body">No running projects in these weeks.</p>}
          {rows.map((p) => {
            const s = p.startDate < startDay ? startDay : p.startDate;
            const e = (p.endDate ?? endDay) > endDay ? endDay : (p.endDate ?? endDay);
            const left = (days(startDay, s) / total) * 100;
            const width = Math.max(1, ((days(s, e) + 1) / total) * 100);
            const hue = projectHue(p.id, p.color);
            return (
              <div key={p.id} className="grid min-h-11 grid-cols-[200px_1fr] items-center border-b">
                <Link href={`/projects/${p.id}`} className="flex min-w-0 items-center gap-2 px-[var(--page-gutter,1rem)] text-body hover:underline">
                  <Dot color={hue} />
                  <span className="text-muted-foreground tabular shrink-0">{p.code}</span>
                  <span className="truncate">{p.name}</span>
                </Link>
                <div className="relative h-full">
                  {weeks.map((w, i) => (
                    <span key={w} className="absolute inset-y-0 border-l" style={{ left: `${(i / WEEKS) * 100}%` }} aria-hidden />
                  ))}
                  {todayLeft !== null && <span className="bg-destructive absolute inset-y-0 w-px" style={{ left: `${todayLeft}%` }} aria-hidden />}
                  <Link
                    href={`/projects/${p.id}`}
                    title={`${p.code} · ${formatDateShort(p.startDate)} – ${p.endDate ? formatDateShort(p.endDate) : "open"} · ${p.openTasks} open tasks`}
                    className="absolute top-1/2 flex h-6 -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-md border px-2 text-caption"
                    style={{ left: `${left}%`, width: `${width}%`, backgroundColor: "var(--accent)", borderColor: hue }}
                  >
                    <span className="truncate">{p.endDate ? `Ends ${formatDateShort(p.endDate)}` : "Ongoing"}</span>
                  </Link>
                  <span className="absolute top-1/2 right-2 -translate-y-1/2">
                    <StatusBadge value={p.standing} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
