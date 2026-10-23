"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TimelineProject, TimelineTask } from "@/lib/dashboard/queries";
import { layoutWeek, sundayOf, type WeekSegment } from "@/lib/hr/pure";
import { addDays, addMonths, monthStart, type IsoDate } from "@/lib/time/pure";
import { formatDateLong, formatDateShort, formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import { projectHue } from "@/components/calendar/project-hue";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckField } from "@/components/check-field";
import { statusLabel } from "@/components/status-badge";
import { Icon } from "@/components/icon";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { CalendarChip, CalendarHeader, Dot, MonthGrid, WEEKDAYS, monthTitle, weekTitle } from "@/components/calendar/month-grid";
import { useOpenTask } from "./widgets";

type Item = { key: string; startDate: IsoDate; endDate: IsoDate } & ({ type: "project"; project: TimelineProject } | { type: "task"; task: TimelineTask });

const NEUTRAL = { backgroundColor: "var(--accent)", borderColor: "var(--border)" };
/** Timelines shown per week in a month; the rest are dots on the days they cover. A week shows them all. */
const LANES = 2;
/** Dots shown in a day before "+N". */
const DOTS = 4;

/**
 * The Designer & Developer's calendar: the projects you're on with an end
 * date as bars from start to end, two per week (more become dots in the
 * day; hovering them lists each one), ongoing ones (no end date) in one
 * row above the grid that scrolls sideways, and your tasks on their due day
 * with their project's colour. Week: the project bars over one column per day holding that
 * day's tasks as cards and the hours you logged. Clicking a project opens
 * it; clicking a task opens the task panel.
 */
export function WorkCalendar({
  view,
  month,
  weekStart,
  today,
  projects,
  tasks,
  minutesByDay,
}: {
  view: "month" | "week";
  month: IsoDate;
  /** Sunday of the week shown (week view). */
  weekStart: IsoDate | null;
  today: IsoDate;
  projects: TimelineProject[];
  tasks: TimelineTask[];
  minutesByDay: Record<IsoDate, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openTask = useOpenTask();
  const [pending, start] = useTransition();
  const [showTasks, setShowTasks] = useState(true);

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const goMonth = (m: IsoDate) => navigate({ view: null, week: null, month: m === monthStart(today) ? null : m.slice(0, 7) });
  const goWeek = (ws: IsoDate) => navigate({ view: "week", month: null, week: ws === sundayOf(today) ? null : ws });

  const ongoing = projects.filter((p) => p.openEnded);
  const items: Item[] = [
    ...projects.filter((p) => !p.openEnded).map((p): Item => ({ key: `p:${p.id}`, startDate: p.startDate, endDate: p.endDate, type: "project", project: p })),
    ...(showTasks ? tasks.map((t): Item => ({ key: `t:${t.id}`, startDate: t.dueDate, endDate: t.dueDate, type: "task", task: t })) : []),
  ];
  const open = (it: Item) => (it.type === "project" ? router.push(`/projects/${it.project.id}`) : openTask(it.task.id));
  /** Done tasks and finished projects fade. */
  const isPast = (it: Item) => (it.type === "task" ? it.task.status === "done" : !it.project.openEnded && it.endDate < today);
  const colorOf = new Map(projects.map((p) => [p.id, p.color]));
  const color = (it: Item) => (it.type === "project" ? projectHue(it.project.id, it.project.color) : projectHue(it.task.projectId, colorOf.get(it.task.projectId) ?? null));
  const titleOf = (it: Item) => (it.type === "project" ? `${it.project.code} · ${it.project.name}` : it.task.title);
  const chip = (s: WeekSegment<Item>) => (
    <CalendarChip
      key={s.item.key}
      seg={s}
      title={titleOf(s.item)}
      time={s.item.type === "task" ? s.item.task.projectCode : s.continuesAfter ? null : `Ends ${formatDateShort(s.item.endDate)}`}
      past={isPast(s.item)}
      fill={NEUTRAL}
      leading={s.item.type === "project" ? <Dot color={color(s.item)} /> : <TaskMark color={color(s.item)} />}
      onOpen={() => open(s.item)}
      clickable
    />
  );
  const dots = (day: IsoDate, hidden: WeekSegment<Item>[]) => (
    <OverflowDots key={day} day={day} hidden={hidden.map((s) => s.item)} color={color} titleOf={titleOf} onOpen={open} />
  );

  return (
    <section aria-label="Project timeline" className="flex min-h-dvh min-w-0 flex-col">
      <CalendarHeader
        title={view === "week" ? weekTitle(weekStart!) : monthTitle(month)}
        pending={pending}
        unit={view}
        onToday={() => (view === "week" ? goWeek(sundayOf(today)) : goMonth(monthStart(today)))}
        onStep={(n) => (view === "week" ? goWeek(addDays(weekStart!, 7 * n)) : goMonth(addMonths(month, n)))}
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="icon-compact" aria-label="Calendar settings" title="Calendar settings">
                <Icon name="filter" size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <CheckField id="cal-tasks" checked={showTasks} onChange={setShowTasks} label="Show my tasks" hint="Tasks you own or help on, on their due day." />
            </PopoverContent>
          </Popover>
        }
      >
        <Tabs
          value={view}
          onValueChange={(v) => (v === "week" ? goWeek(month === monthStart(today) ? sundayOf(today) : sundayOf(month)) : goMonth(monthStart(weekStart!)))}
          size="compact"
        >
          <TabsList aria-label="Calendar view">
            <TabItem value="month" label="Month" />
            <TabItem value="week" label="Week" />
          </TabsList>
        </Tabs>
      </CalendarHeader>
      {ongoing.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pr-4 pb-3 pl-[var(--page-gutter,1rem)] [scrollbar-width:thin]">
          <span className="text-muted-foreground mr-1 shrink-0 text-caption">Ongoing</span>
          {ongoing.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => router.push(`/projects/${p.id}`)}
              title={`${p.code} · ${p.name} — no end date`}
              className="flex h-7 max-w-72 shrink-0 items-center gap-1.5 rounded-md border px-2 text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
              style={NEUTRAL}
            >
              <Dot color={projectHue(p.id, p.color)} />
              <span className="shrink-0 font-medium">{p.code}</span>
              <span className="text-muted-foreground truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {view === "month" ? (
        <MonthGrid month={month} today={today} items={items} pending={pending} lanes={LANES} renderMore={dots} renderChip={chip} />
      ) : (
        <WorkWeek weekStart={weekStart!} today={today} items={items} pending={pending} chip={chip} minutesByDay={minutesByDay} isPast={isPast} color={color} onOpen={open} />
      )}
      {/* Legend: a dot is a project, a hollow square a task. */}
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t py-2.5 pl-[var(--page-gutter,1rem)] text-caption">
        <span className="flex items-center gap-1.5">
          <Dot color="var(--muted-foreground)" /> Project
        </span>
        <span className="flex items-center gap-1.5">
          <TaskMark color="var(--muted-foreground)" /> Task due
        </span>
      </p>

    </section>
  );
}

/**
 * The timelines past the shown lanes on one day: a dot each (up to DOTS,
 * then "+N"). Hovering — or clicking — opens a list of them, each one
 * opening its project or task.
 */
function OverflowDots({
  day,
  hidden,
  color,
  titleOf,
  onOpen,
}: {
  day: IsoDate;
  hidden: Item[];
  color: (it: Item) => string;
  titleOf: (it: Item) => string;
  onOpen: (it: Item) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={100}
        closeDelay={150}
        onClick={(e) => e.stopPropagation()}
        aria-label={`${hidden.length} more on ${formatDateLong(day)}`}
        className="hover:bg-hover data-[popup-open]:bg-hover pointer-events-auto flex h-6 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
      >
        {hidden.slice(0, DOTS).map((it) => (
          <Dot key={it.key} color={color(it)} />
        ))}
        {hidden.length > DOTS && <span className="text-muted-foreground tabular text-caption">+{hidden.length - DOTS}</span>}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 gap-1 p-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="text-muted-foreground px-1.5 pt-0.5 pb-1 text-caption">{formatDateLong(day)}</p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {hidden.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpen(it);
                }}
                className="hover:bg-hover flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
              >
                {it.type === "project" ? <Dot color={color(it)} /> : <TaskMark color={color(it)} />}
                <span className="min-w-0 flex-1 truncate font-medium">{titleOf(it)}</span>
                <span className="text-muted-foreground shrink-0 tabular text-caption">
                  {it.type === "task" ? statusLabel(it.task.status) : it.project.openEnded ? "No end date" : `until ${formatDateShort(it.project.endDate)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A task's mark: a hollow square in its project's hue (a project's is a dot). */
function TaskMark({ color }: { color: string }) {
  return <span className="size-2 shrink-0 rounded-[3px] border-[1.5px]" style={{ borderColor: color }} />;
}

/**
 * One Sunday-first week: every project bar on top, then a
 * column per day with the tasks due that day as cards and, at the foot, the
 * hours you logged — time entries carry no clock time, so there's no hour grid.
 */
function WorkWeek({
  weekStart,
  today,
  items,
  pending,
  chip,
  minutesByDay,
  isPast,
  color,
  onOpen,
}: {
  weekStart: IsoDate;
  today: IsoDate;
  items: Item[];
  pending: boolean;
  chip: (s: WeekSegment<Item>) => ReactNode;
  minutesByDay: Record<IsoDate, number>;
  isPast: (it: Item) => boolean;
  color: (it: Item) => string;
  onOpen: (it: Item) => void;
}) {
  const week = layoutWeek(weekStart, items.filter((it) => it.type === "project"));
  const lanes = week.segments.length ? Math.max(...week.segments.map((s) => s.lane + 1)) : 0;
  return (
    <div className="flex flex-1 flex-col overflow-x-auto">
      <div className={cn("flex min-w-[720px] flex-1 flex-col transition-opacity", pending && "opacity-60")}>
        <div className="grid grid-cols-7 border-b">
          {week.days.map((d, i) => (
            <span key={d} className="flex items-center gap-1.5 px-3 pb-2 text-body first:pl-[var(--page-gutter,1rem)]">
              <span className="text-muted-foreground">{WEEKDAYS[i]}</span>
              <span className={cn("tabular grid h-6 min-w-6 place-items-center rounded-full px-1", d === today && "bg-foreground text-background font-medium")}>{Number(d.slice(8, 10))}</span>
            </span>
          ))}
        </div>
        {lanes > 0 && (
          <div className="relative grid grid-cols-7 border-b" style={{ minHeight: lanes * 32 + 8 }}>
            {week.days.map((d) => (
              <div key={d} className="border-r nth-7:border-r-0" />
            ))}
            <div className="pointer-events-none absolute inset-x-0 top-1 grid grid-cols-7 gap-y-1" style={{ gridAutoRows: "28px" }}>
              {week.segments.map(chip)}
            </div>
          </div>
        )}
        <div className="grid min-h-[480px] flex-1 grid-cols-7">
          {week.days.map((d) => {
            const due = items.filter((it): it is Extract<Item, { type: "task" }> => it.type === "task" && it.startDate === d);
            const minutes = minutesByDay[d] ?? 0;
            return (
              <div key={d} className={cn("flex min-w-0 flex-col gap-1.5 border-r p-1.5 nth-7:border-r-0", d === today && "bg-hover")}>
                {due.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onOpen(it)}
                    title={it.task.title}
                    className={cn(
                      "flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
                      isPast(it) && "*:opacity-50",
                    )}
                    style={NEUTRAL}
                  >
                    <span className="flex min-w-0 items-start gap-1.5">
                      <span className="mt-[5px] flex">
                        <TaskMark color={color(it)} />
                      </span>
                      <span className="line-clamp-2 min-w-0 font-medium break-words hyphens-auto">{it.task.title}</span>
                    </span>
                    <span className="text-muted-foreground truncate pl-3.5 text-caption">
                      {it.task.projectCode} · {statusLabel(it.task.status)}
                    </span>
                  </button>
                ))}
                <span className={cn("text-muted-foreground tabular mt-auto pt-2 text-caption", d > today && "invisible")}>{minutes ? `${formatHours(minutes)} logged` : "No time logged"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
