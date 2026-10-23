"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PmProject } from "@/lib/dashboard/queries";
import { sundayOf, type WeekSegment } from "@/lib/hr/pure";
import { addDays, addMonths, monthStart, type IsoDate } from "@/lib/time/pure";
import { formatDateLong, formatDateShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { Icon } from "@/components/icon";
import { CalendarChip, CalendarHeader, Dot, MonthGrid, MoreDots, monthTitle } from "@/components/calendar/month-grid";
import { projectHue } from "@/components/calendar/project-hue";
import { ProjectColorPicker } from "./project-color-picker";

type Item = { key: string; startDate: IsoDate; endDate: IsoDate; project: PmProject };

const NEUTRAL = { backgroundColor: "var(--accent)", borderColor: "var(--border)" };

/**
 * The PM's calendar: the projects you run as bars from start to end (an open
 * end runs to the grid's last day), two per week; more become dots in the
 * day, which open that day's list. Clicking a project opens it. The settings
 * popover sets each project's colour.
 */
export function PmCalendar({ month, today, projects, switcher }: { month: IsoDate; today: IsoDate; projects: PmProject[]; switcher?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [moreDay, setMoreDay] = useState<IsoDate | null>(null);

  const goMonth = (m: IsoDate) => {
    const next = new URLSearchParams(params.toString());
    if (m === monthStart(today)) next.delete("month");
    else next.set("month", m.slice(0, 7));
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const gridEnd = addDays(sundayOf(addDays(addMonths(month, 1), -1)), 6);
  const items: Item[] = projects
    .map((p) => ({ key: p.id, startDate: p.startDate, endDate: p.endDate ?? gridEnd, project: p }))
    .filter((it) => it.endDate >= sundayOf(month) && it.startDate <= gridEnd);
  const open = (p: PmProject) => router.push(`/projects/${p.id}`);
  const color = (p: PmProject) => projectHue(p.id, p.color);

  const chip = (s: WeekSegment<Item>) => (
    <CalendarChip
      key={s.item.key}
      seg={s}
      title={`${s.item.project.code} · ${s.item.project.name}`}
      time={s.continuesAfter ? null : s.item.project.endDate ? `Ends ${formatDateShort(s.item.project.endDate)}` : null}
      fill={NEUTRAL}
      leading={<Dot color={color(s.item.project)} />}
      onOpen={() => open(s.item.project)}
      clickable
    />
  );
  const dots = (day: IsoDate, hidden: WeekSegment<Item>[]) => (
    <MoreDots
      dots={hidden.map((s) => ({ key: s.item.key, color: color(s.item.project) }))}
      label={`${hidden.length} more ${hidden.length === 1 ? "project" : "projects"} on ${formatDateLong(day)}`}
      title={hidden.map((s) => s.item.project.code).join(", ")}
      onClick={() => setMoreDay(day)}
    />
  );

  return (
    <section aria-label="Project calendar" className="flex min-h-dvh min-w-0 flex-col">
      <CalendarHeader
        title={monthTitle(month)}
        pending={pending}
        unit="month"
        onToday={() => goMonth(monthStart(today))}
        onStep={(n) => goMonth(addMonths(month, n))}
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="icon-compact" aria-label="Project colours" title="Project colours">
                <Icon name="filter" size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <p className="text-muted-foreground px-1 pb-1.5 text-caption">Project colours</p>
              {projects.length === 0 && <p className="text-muted-foreground px-1 py-1 text-body">No running projects.</p>}
              <ul className="flex max-h-72 flex-col overflow-y-auto">
                {projects.map((p) => (
                  <li key={p.id} className="flex min-h-8 min-w-0 items-center gap-1.5 text-body">
                    <ProjectColorPicker projectId={p.id} label={p.code} color={p.color} />
                    <span className="tabular shrink-0">{p.code}</span>
                    <span className="text-muted-foreground truncate">{p.name}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        }
      >
        {switcher}
      </CalendarHeader>
      <MonthGrid month={month} today={today} items={items} pending={pending} onMore={setMoreDay} renderMore={dots} renderChip={chip} />

      <Dialog open={moreDay !== null} onOpenChange={(o) => !o && setMoreDay(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{moreDay ? formatDateLong(moreDay) : ""}</DialogTitle>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {moreDay &&
              items
                .filter((it) => it.startDate <= moreDay && it.endDate >= moreDay)
                .map((it) => (
                  <li key={it.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreDay(null);
                        open(it.project);
                      }}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
                      style={NEUTRAL}
                    >
                      <Dot color={color(it.project)} />
                      <span className="tabular shrink-0 font-medium">{it.project.code}</span>
                      <span className="min-w-0 flex-1 truncate">{it.project.name}</span>
                      <StatusBadge value={it.project.standing} className="shrink-0" />
                    </button>
                  </li>
                ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
