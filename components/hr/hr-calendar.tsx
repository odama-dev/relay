"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { HrOccurrence } from "@/lib/hr/pure";
import { LEAVE_KIND_LABELS, layoutDay, layoutWeek, minutesOf, sundayOf, type WeekSegment } from "@/lib/hr/pure";
import type { CalendarView, HrSeries, LeaveBar } from "@/lib/hr/queries";
import { addDays, addMonths, monthStart, timeIn, type IsoDate } from "@/lib/time/pure";
import { formatClock, formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckField } from "@/components/check-field";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { Icon, icons } from "@/components/icon";
import { CalendarChip, CalendarHeader, Dot, MonthGrid, MoreDots, WEEKDAYS, monthTitle, weekTitle } from "@/components/calendar/month-grid";
import { eventTone } from "./event-tone";
import { HrEventDialog, type EventDialogState } from "./hr-event-dialog";

/** Payroll and BPJS from Finance's obligations (Phase 2 · M10), read-only here. */
export type CalendarObligation = { key: string; date: IsoDate; title: string; kind: "payroll" | "bpjs"; done: boolean };

type Item = { key: string; startDate: IsoDate; endDate: IsoDate } & (
  | { type: "event"; occ: HrOccurrence }
  | { type: "leave"; leave: LeaveBar }
  | { type: "obligation"; ob: CalendarObligation }
);

/** Dot and fill of an item; leave has none (it shows a person icon). */
function toneOf(it: Item) {
  if (it.type === "event") return eventTone(it.occ.color);
  if (it.type === "obligation") return eventTone(it.ob.kind === "payroll" ? "blue" : "teal");
  return null;
}

/**
 * HR's calendar. Month: Sunday-first weeks, events as chips (multi-day ones
 * as bars across the days they cover), approved team leave as dashed bars;
 * two per week, the rest as dots that open the day (leave's dot is grey).
 * Week: an all-day row over an hour grid where timed events are blocks as
 * long as they last, side by side when they overlap, with a line at the
 * current time. Every chip is neutral; only its dot carries the colour. HR
 * adds an event from "New event" or by clicking a day or an hour.
 */
export function HrCalendar({
  view,
  month,
  weekStart,
  today,
  timezone,
  occurrences,
  series,
  leave,
  obligations = [],
  canEdit,
}: {
  view: CalendarView;
  month: IsoDate;
  /** Sunday of the week shown (week view). */
  weekStart: IsoDate | null;
  today: IsoDate;
  timezone: string;
  occurrences: HrOccurrence[];
  series: Record<string, HrSeries>;
  leave: LeaveBar[];
  obligations?: CalendarObligation[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [showLeave, setShowLeave] = useState(true);
  const [dialog, setDialog] = useState<EventDialogState | null>(null);
  const [moreDay, setMoreDay] = useState<IsoDate | null>(null);

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
  const step = (n: number) => (view === "week" ? goWeek(addDays(weekStart!, 7 * n)) : goMonth(addMonths(month, n)));

  const items: Item[] = [
    ...occurrences.map((occ): Item => ({ key: occ.key, startDate: occ.startDate, endDate: occ.endDate, type: "event", occ })),
    ...(showLeave ? leave.map((l): Item => ({ key: l.key, startDate: l.startDate, endDate: l.endDate, type: "leave", leave: l })) : []),
    ...obligations.map((ob): Item => ({ key: ob.key, startDate: ob.date, endDate: ob.date, type: "obligation", ob })),
  ];
  const open = (it: Item) => {
    if (it.type === "event" && canEdit) setDialog({ mode: "edit", occurrence: it.occ, series: series[it.occ.eventId]! });
  };
  const dayItems = (d: IsoDate) => items.filter((it) => it.startDate <= d && it.endDate >= d);
  const now = useNowMinutes(timezone);
  /** Over: ended before today, or a timed event today whose end has passed. */
  const isPast = (it: Item) =>
    it.endDate < today || (it.endDate === today && it.type === "event" && !it.occ.allDay && now !== null && minutesOf(it.occ.endTime!) <= now);
  const title = view === "week" ? weekTitle(weekStart!) : monthTitle(month);
  const newDate = view === "week" ? (weekStart! <= today && today <= addDays(weekStart!, 6) ? today : weekStart!) : month === monthStart(today) ? today : month;

  return (
    <section aria-label="HR calendar" className="flex min-h-dvh min-w-0 flex-col">
      <CalendarHeader
        title={title}
        pending={pending}
        unit={view}
        onToday={() => (view === "week" ? goWeek(sundayOf(today)) : goMonth(monthStart(today)))}
        onStep={step}
        actions={
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="icon-compact" aria-label="Calendar settings" title="Calendar settings">
                  <Icon name="filter" size={14} />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <CheckField id="cal-leave" checked={showLeave} onChange={setShowLeave} label="Show team leave" hint="Approved leave, permits and sick days." />
              </PopoverContent>
            </Popover>
            {canEdit && (
              <Button size="compact" leadingIcon={icons.add} onClick={() => setDialog({ mode: "new", date: newDate })}>
                New event
              </Button>
            )}
          </>
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

      {view === "month" ? (
        <MonthGrid
          month={month}
          today={today}
          items={items}
          pending={pending}
          renderMore={(d, hidden) => (
            <MoreDots
              dots={hidden.map((s) => ({ key: s.item.key, color: toneOf(s.item)?.dot ?? "var(--muted-foreground)" }))}
              label={`${hidden.length} more on ${formatDateLong(d)}`}
              title={hidden.map((s) => label(s.item).title).join(", ")}
              onClick={() => setMoreDay(d)}
            />
          )}
          onDay={canEdit ? (d) => setDialog({ mode: "new", date: d }) : undefined}
          renderChip={(s) => <Chip key={s.item.key} seg={s} past={isPast(s.item)} onOpen={() => open(s.item)} clickable={s.item.type === "event" && canEdit} />}
        />
      ) : (
        <WeekGrid
          weekStart={weekStart!}
          today={today}
          now={now}
          isPast={isPast}
          items={items}
          pending={pending}
          canEdit={canEdit}
          onOpen={open}
          onNew={(date, startTime) => setDialog({ mode: "new", date, startTime })}
        />
      )}

      <HrEventDialog state={dialog} onOpenChange={(o) => !o && setDialog(null)} />
      <Dialog open={moreDay !== null} onOpenChange={(o) => !o && setMoreDay(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{moreDay ? formatDateLong(moreDay) : ""}</DialogTitle>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {moreDay &&
              dayItems(moreDay).map((it) => (
                <li key={it.key}>
                  <ItemRow
                    item={it}
                    onOpen={() => {
                      setMoreDay(null);
                      open(it);
                    }}
                    clickable={it.type === "event" && canEdit}
                  />
                </li>
              ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function label(it: Item) {
  if (it.type === "obligation") return { title: it.ob.done ? `${it.ob.title} · done` : it.ob.title, time: null };
  if (it.type === "leave") return { title: `${it.leave.name} · ${LEAVE_KIND_LABELS[it.leave.kind]}`, time: it.leave.halfDay ? "Half day" : null };
  return { title: it.occ.title, time: it.occ.allDay ? null : formatClock(it.occ.startTime!) };
}

/** One week's piece of an item; `past` fades its text and dot (the fill stays) once it's over. */
function Chip({ seg, past = false, onOpen, clickable }: { seg: WeekSegment<Item>; past?: boolean; onOpen: () => void; clickable: boolean }) {
  const it = seg.item;
  const { title, time } = label(it);
  const tone = toneOf(it);
  return (
    <CalendarChip
      seg={seg}
      title={title}
      time={time}
      past={past}
      dashed={it.type === "leave"}
      fill={tone?.fill}
      leading={tone ? <Dot color={tone.dot} /> : <Icon name="user" size={12} className="shrink-0" />}
      onOpen={onOpen}
      clickable={clickable}
    />
  );
}

function ItemRow({ item, onOpen, clickable }: { item: Item; onOpen: () => void; clickable: boolean }) {
  const { title, time } = label(item);
  const tone = toneOf(item);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!clickable}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:cursor-default",
        item.type === "leave" && "text-muted-foreground border-dashed",
      )}
      style={tone?.fill}
    >
      {tone ? <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} /> : <Icon name="user" size={12} className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      <span className="text-muted-foreground shrink-0 tabular text-caption">
        {time ?? (item.startDate !== item.endDate ? `until ${Number(item.endDate.slice(8, 10))} ${new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${item.endDate}T00:00:00Z`))}` : "All day")}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Week: an all-day row over an hour grid
// ---------------------------------------------------------------------------

/** Pixels per hour on the week grid. */
const HOUR = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The viewer's wall-clock minutes in the studio zone, refreshed each minute (null until mounted). */
function useNowMinutes(timezone: string) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(minutesOf(timeIn(timezone)));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [timezone]);
  return now;
}

function WeekGrid({
  weekStart,
  today,
  now,
  isPast,
  items,
  pending,
  canEdit,
  onOpen,
  onNew,
}: {
  weekStart: IsoDate;
  today: IsoDate;
  now: number | null;
  isPast: (it: Item) => boolean;
  items: Item[];
  pending: boolean;
  canEdit: boolean;
  onOpen: (it: Item) => void;
  onNew: (date: IsoDate, startTime?: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Open on the working day, not midnight.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR - 8;
  }, []);

  const timed = (it: Item) => it.type === "event" && !it.occ.allDay && it.startDate === it.endDate;
  const week = layoutWeek(weekStart, items.filter((it) => !timed(it)));
  const lanes = Math.max(1, ...week.segments.map((s) => s.lane + 1));

  return (
    <div className="flex flex-1 flex-col overflow-x-auto">
      <div className={cn("flex min-w-[720px] flex-1 flex-col transition-opacity", pending && "opacity-60")}>
        {/* Day headers */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b">
          <span />
          {week.days.map((d) => (
            <span key={d} className="flex items-center gap-1.5 px-3 pb-2 text-body">
              <span className="text-muted-foreground">{WEEKDAYS[week.days.indexOf(d)]}</span>
              <span className={cn("tabular grid h-6 min-w-6 place-items-center rounded-full px-1", d === today && "bg-foreground text-background font-medium")}>{Number(d.slice(8, 10))}</span>
            </span>
          ))}
        </div>

        {/* All day */}
        <div className="grid grid-cols-[56px_minmax(0,1fr)] border-b">
          <span className="text-muted-foreground px-2 pt-2 text-right text-caption">All day</span>
          <div className="relative grid grid-cols-7">
            {week.days.map((d) => (
              <div key={d} className="min-h-10 border-l" style={{ minHeight: lanes * 32 + 8 }} />
            ))}
            <div className="pointer-events-none absolute inset-x-0 top-1 grid grid-cols-7 gap-y-1" style={{ gridAutoRows: "28px" }}>
              {week.segments.map((s) => (
                <Chip key={s.item.key} seg={s} past={isPast(s.item)} onOpen={() => onOpen(s.item)} clickable={s.item.type === "event" && canEdit} />
              ))}
            </div>
          </div>
        </div>

        {/* Hours */}
        {/* The hours fill the rest of the calendar's viewport height and scroll. */}
        <div ref={scroller} className="min-h-[480px] flex-1 basis-0 overflow-y-auto">
          <div className="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR }}>
            <div className="relative">
              {HOURS.slice(1).map((h) => (
                <span key={h} className="text-muted-foreground tabular absolute right-2 -translate-y-1/2 text-caption" style={{ top: h * HOUR }}>
                  {clock(h * 60)}
                </span>
              ))}
            </div>
            {week.days.map((d) => {
              const blocks = layoutDay(
                items
                  .filter((it) => timed(it) && it.startDate === d)
                  .map((it) => {
                    const occ = (it as Extract<Item, { type: "event" }>).occ;
                    return { item: it, start: minutesOf(occ.startTime!), end: minutesOf(occ.endTime!) };
                  }),
              );
              return (
                <div
                  key={d}
                  className={cn("relative border-l", canEdit && "cursor-pointer")}
                  style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, var(--border) ${HOUR - 1}px, var(--border) ${HOUR}px)` }}
                  onClick={canEdit ? (e) => onNew(d, clock(Math.min(23, Math.floor(e.nativeEvent.offsetY / HOUR)) * 60)) : undefined}
                  aria-label={canEdit ? `Add an event on ${formatDateLong(d)}` : undefined}
                >
                  {blocks.map((b) => {
                    const occ = (b.item as Extract<Item, { type: "event" }>).occ;
                    const tone = eventTone(occ.color);
                    const height = Math.max(22, ((b.end - b.start) / 60) * HOUR - 2);
                    return (
                      <button
                        key={b.item.key}
                        type="button"
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(b.item);
                        }}
                        title={`${occ.title} · ${occ.startTime}–${occ.endTime}`}
                        className={cn(
                          "absolute flex flex-col gap-0.5 overflow-hidden rounded-md border px-2 py-1 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:cursor-default",
                          isPast(b.item) && "*:opacity-50",
                        )}
                        style={{ top: (b.start / 60) * HOUR + 1, height, left: `calc(${(b.col / b.cols) * 100}% + 2px)`, width: `calc(${100 / b.cols}% - 4px)`, ...tone.fill }}
                      >
                        <span className="flex min-w-0 items-start gap-1.5">
                          <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
                          {/* Tall blocks let the title wrap; short ones keep one line. */}
                          <span className={cn("min-w-0 font-medium", height > 48 ? "line-clamp-3" : "truncate")}>{occ.title}</span>
                        </span>
                        {height > 36 && <span className="text-muted-foreground tabular truncate text-caption">{`${occ.startTime}–${occ.endTime}`}</span>}
                      </button>
                    );
                  })}
                  {d === today && now !== null && (
                    <span aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (now / 60) * HOUR }}>
                      <span className="bg-destructive -ml-1 size-2 rounded-full" />
                      <span className="bg-destructive h-0.5 flex-1" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
