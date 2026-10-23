"use client";

import type { CSSProperties, ReactNode } from "react";
import { layoutMonth, type GridItem, type WeekSegment } from "@/lib/hr/pure";
import { addDays, type IsoDate } from "@/lib/time/pure";
import { formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" });
  return (d: IsoDate) => f.format(new Date(`${d}T00:00:00Z`));
};
export const monthTitle = fmt({ month: "long", year: "numeric" });
const monthShort = fmt({ month: "short" });
/** "October 2026", or "Oct – Nov 2026" for a week across two months. */
export function weekTitle(ws: IsoDate) {
  const we = addDays(ws, 6);
  if (ws.slice(0, 7) === we.slice(0, 7)) return monthTitle(ws);
  return ws.slice(0, 4) === we.slice(0, 4) ? `${monthShort(ws)} – ${monthShort(we)} ${we.slice(0, 4)}` : `${monthShort(ws)} ${ws.slice(0, 4)} – ${monthShort(we)} ${we.slice(0, 4)}`;
}

/** A calendar's header: the title, `children` (a view toggle), Today and previous / next, then `actions`. */
export function CalendarHeader({
  title,
  pending,
  unit,
  onToday,
  onStep,
  children,
  actions,
}: {
  title: string;
  pending: boolean;
  unit: "month" | "week";
  onToday: () => void;
  onStep: (n: number) => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-2 py-2 pr-4 pl-[var(--page-gutter,1rem)]">
      <h2 className={cn("text-subtitle mr-auto font-semibold transition-opacity", pending && "opacity-50")}>{title}</h2>
      {children}
      <Button variant="ghost" size="compact" onClick={onToday}>
        Today
      </Button>
      <span className="flex items-center">
        <Button variant="ghost" size="icon-compact" aria-label={`Previous ${unit}`} onClick={() => onStep(-1)}>
          <Icon name="chevronLeft" size={14} />
        </Button>
        <Button variant="ghost" size="icon-compact" aria-label={`Next ${unit}`} onClick={() => onStep(1)}>
          <Icon name="chevronRight" size={14} />
        </Button>
      </span>
      {actions}
    </header>
  );
}

/**
 * A month as Sunday-first weeks with items laid over the days they cover:
 * multi-day ones as bars, stacked into lanes, `lanes` (two) shown per week
 * and the rest behind "+N more" — or `renderMore`, given the day's hidden
 * segments, usually `MoreDots`. Week views show every lane.
 * The weeks share whatever height the parent gives (calendars are a
 * viewport tall). Clicking a day calls `onDay` when given.
 */
export function MonthGrid<T extends GridItem>({
  month,
  today,
  items,
  pending,
  lanes = 2,
  renderChip,
  onMore,
  renderMore,
  onDay,
  dayLabel = (d) => `Add an event on ${formatDateLong(d)}`,
}: {
  month: IsoDate;
  today: IsoDate;
  items: T[];
  pending: boolean;
  lanes?: number;
  renderChip: (seg: WeekSegment<T>) => ReactNode;
  /** Called by the default "+N more"; not needed with `renderMore`. */
  onMore?: (day: IsoDate) => void;
  renderMore?: (day: IsoDate, hidden: WeekSegment<T>[]) => ReactNode;
  onDay?: (day: IsoDate) => void;
  dayLabel?: (day: IsoDate) => string;
}) {
  const weeks = layoutMonth(month, items);
  // On a phone the grid keeps a readable width and scrolls sideways.
  return (
    <div className="flex flex-1 flex-col overflow-x-auto">
      <div className={cn("flex min-w-[640px] flex-1 flex-col transition-opacity", pending && "opacity-60")}>
        <div className="grid grid-cols-7 border-b">
          {WEEKDAYS.map((d) => (
            <span key={d} className="text-muted-foreground px-3 pb-2 text-caption first:pl-[var(--page-gutter,1rem)]">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((w) => {
          const hidden = w.segments.filter((s) => s.lane >= lanes);
          return (
            <div key={w.days[0]} className="relative grid flex-1 grid-cols-7 border-b last:border-b-0" style={{ minHeight: lanes * 32 + 36 }}>
              {w.days.map((d) => {
                const outside = d.slice(0, 7) !== month.slice(0, 7);
                const hiddenHere = hidden.filter((s) => d >= s.item.startDate && d <= s.item.endDate);
                const more = hiddenHere.length;
                return (
                  <div
                    key={d}
                    role={onDay ? "button" : undefined}
                    tabIndex={onDay ? -1 : undefined}
                    aria-label={onDay ? dayLabel(d) : undefined}
                    onClick={onDay ? () => onDay(d) : undefined}
                    className={cn("relative flex flex-col justify-end border-r p-2 nth-7:border-r-0", onDay && "hover:bg-hover cursor-pointer")}
                  >
                    <span className="flex items-end justify-between gap-1">
                      {more > 0 && renderMore ? (
                        renderMore(d, hiddenHere)
                      ) : more > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMore?.(d);
                          }}
                          className="text-muted-foreground hover:text-foreground text-caption font-medium"
                        >
                          +{more} more
                        </button>
                      ) : (
                        <span />
                      )}
                      <span
                        className={cn(
                          "tabular grid h-6 min-w-6 place-items-center rounded-full px-1 text-body",
                          outside ? "text-muted-foreground" : "text-foreground",
                          d === today && "bg-foreground text-background font-medium",
                        )}
                      >
                        {Number(d.slice(8, 10))}
                      </span>
                    </span>
                  </div>
                );
              })}
              <div className="pointer-events-none absolute inset-x-0 top-2 grid grid-cols-7 gap-y-1" style={{ gridAutoRows: "28px" }}>
                {w.segments.filter((s) => s.lane < lanes).map(renderChip)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One week's piece of an item: a neutral chip whose `leading` mark (a dot)
 * carries the colour. `past` fades its text once it's over; `dashed` is for
 * items that aren't the calendar's own (team leave).
 */
export function CalendarChip({
  seg,
  title,
  time,
  leading,
  fill,
  past = false,
  dashed = false,
  onOpen,
  clickable,
}: {
  seg: WeekSegment<GridItem>;
  title: string;
  time?: string | null;
  leading: ReactNode;
  fill?: CSSProperties;
  past?: boolean;
  dashed?: boolean;
  onOpen: () => void;
  clickable: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      disabled={!clickable}
      title={time ? `${title} · ${time}` : title}
      className={cn(
        "@container pointer-events-auto mx-2 flex min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] disabled:cursor-default",
        dashed && "bg-background text-muted-foreground border-dashed",
        past && "*:opacity-50",
        seg.continuesBefore && "ml-0 rounded-l-none border-l-0",
        seg.continuesAfter && "mr-0 rounded-r-none border-r-0",
      )}
      style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: seg.lane + 1, ...fill }}
    >
      {leading}
      <span className="min-w-0 truncate font-medium">{title}</span>
      {/* The time only when the chip has room; the title always wins. */}
      {time && <span className="text-muted-foreground hidden shrink-0 tabular @[10rem]:inline">{time}</span>}
    </button>
  );
}

/** Dots shown in a day before "+N". */
const MORE_DOTS = 4;

/** A month day's hidden timelines: a dot each (up to four, then "+N"); clicking opens the day. */
export function MoreDots({ dots, label, title, onClick }: { dots: { key: string; color: string }[]; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={title}
      className="hover:bg-hover flex h-6 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
    >
      {dots.slice(0, MORE_DOTS).map((d) => (
        <Dot key={d.key} color={d.color} />
      ))}
      {dots.length > MORE_DOTS && <span className="text-muted-foreground tabular text-caption">+{dots.length - MORE_DOTS}</span>}
    </button>
  );
}

/** A coloured dot for a chip or a row. */
export function Dot({ color }: { color: string }) {
  return <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}
