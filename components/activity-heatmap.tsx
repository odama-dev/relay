"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { formatDateShort, formatHours, formatWeekday } from "@/lib/format";

/**
 * Logged time as a heat calendar: one column per Monday-first week, one cell
 * per day, magnitude as the alpha of one hue (never a second colour).
 * Hovering a cell shows its hours; clicking pins that week — the column sits
 * on a faint plate and the footer keeps its total — until clicked again or
 * Escape. Hovered cells lift with their neighbours (pointer devices only).
 * Days after today stay blank.
 */

export type HeatDay = { date: string; minutes: number };

const EASE = [0.16, 1, 0.3, 1] as const;
const LIFT_SPRING = { type: "spring", stiffness: 500, damping: 30 } as const;
/** How far a cell rises when hovered, its neighbour, or two away. */
const LIFT = [1.3, 1.08, 1.03];
const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;
/** Left column for the weekday labels. */
const LABELS = 26;
const DOW = ["Mon", "", "Wed", "", "Fri", "", ""];
/** Five intensity steps — colour-mix percentages of the hue. */
const STEPS = [6, 20, 38, 58, 80];
/** A full day: the top step. */
const FULL_DAY = 8 * 60;
const HUE = "var(--chart-in)";
const tint = (pct: number) => `color-mix(in srgb, ${HUE} ${pct}%, transparent)`;
const step = (minutes: number) => (minutes <= 0 ? STEPS[0]! : STEPS[Math.min(4, 1 + Math.floor((minutes / FULL_DAY) * 4))]!);

/** Pointer devices only: touch never hovers, so the ripple stays off there. */
function useCanHover() {
  const [can, setCan] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    const onChange = () => setCan(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return can;
}

export function ActivityHeatmap({ weeks, today }: { weeks: HeatDay[][]; today: string }) {
  const reduced = useReducedMotion();
  const canHover = useCanHover();
  const [hover, setHover] = useState<{ w: number; d: number } | null>(null);
  const [pinWeek, setPinWeek] = useState<number | null>(null);

  const total = weeks.flat().reduce((s, d) => s + d.minutes, 0);
  const weekTotal = (w: number) => weeks[w]!.reduce((s, d) => s + d.minutes, 0);
  const hovered = hover ? weeks[hover.w]![hover.d]! : null;
  const n = weeks.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular text-body font-medium">{formatHours(total)}</span>
        <span className="text-muted-foreground text-caption">Last {n} weeks</span>
      </div>

      <div className="relative flex" style={{ gap: GAP }} onPointerLeave={() => setHover(null)}>
        <div className="flex flex-col" style={{ gap: GAP, width: LABELS - GAP }}>
          {DOW.map((d, i) => (
            <span key={i} className="text-muted-foreground text-micro leading-none" style={{ height: CELL, lineHeight: `${CELL}px` }}>
              {d}
            </span>
          ))}
        </div>
        {weeks.map((days, w) => {
          const colOn = pinWeek === w || hover?.w === w;
          return (
            <motion.div
              key={days[0]!.date}
              className="flex flex-col rounded-[4px] transition-colors"
              style={{ gap: GAP, background: pinWeek === w ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "transparent" }}
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.4, ease: EASE, delay: w * 0.025 }}
            >
              {days.map((day, d) => {
                if (day.date > today) return <span key={day.date} className="block" style={{ width: CELL, height: CELL }} />;
                const on = hover?.w === w && hover?.d === d;
                const dist = hover ? Math.max(Math.abs(hover.w - w), Math.abs(hover.d - d)) : 9;
                const lift = reduced ? 1 : dist === 0 ? LIFT[0]! : canHover && dist < LIFT.length ? LIFT[dist]! : 1;
                return (
                  <span key={day.date} className="relative block" style={{ width: CELL, height: CELL, zIndex: lift > 1 ? LIFT.length - dist : 0 }}>
                    {/* The hit area covers half the gap on each side so a fast pointer never falls through. */}
                    <button
                      type="button"
                      aria-label={`${formatHours(day.minutes)} · ${formatWeekday(day.date)}`}
                      aria-pressed={pinWeek === w}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setPinWeek(null);
                          setHover(null);
                        }
                      }}
                      onPointerEnter={() => setHover({ w, d })}
                      onFocus={() => setHover({ w, d })}
                      onBlur={() => setHover(null)}
                      onClick={() => setPinWeek((p) => (p === w ? null : w))}
                      className="absolute -inset-[1.5px] block cursor-pointer rounded-[4px] outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
                    >
                      <motion.span
                        className="pointer-events-none absolute inset-[1.5px] block rounded-[3px]"
                        style={{
                          background: tint(step(day.minutes)),
                          // A resting hairline so every cell keeps an edge on the page background.
                          boxShadow: on
                            ? "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 40%, transparent)"
                            : `inset 0 0 0 1px color-mix(in srgb, var(--foreground) ${colOn ? 14 : 6}%, transparent)`,
                          transition: "box-shadow 150ms",
                        }}
                        animate={{ scale: lift }}
                        transition={{ ...LIFT_SPRING, delay: Math.min(dist, 3) * 0.03 }}
                      />
                    </button>
                  </span>
                );
              })}
            </motion.div>
          );
        })}

        {/* The tooltip rides the hovered cell, placed from the grid pitch. */}
        <AnimatePresence>
          {hover && hovered && (
            <motion.span
              key={hovered.date}
              role="status"
              className="bg-popover text-foreground/75 pointer-events-none absolute z-10 rounded-md border px-1.5 py-0.5 text-caption whitespace-nowrap tabular shadow-md"
              style={{
                left: LABELS + hover.w * PITCH + (hover.w < 3 ? 0 : hover.w > n - 4 ? CELL : CELL / 2),
                top: hover.d * PITCH - 4,
                translate: hover.w < 3 ? "0 -100%" : hover.w > n - 4 ? "-100% -100%" : "-50% -100%",
              }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.12 }}
            >
              <b className="text-foreground font-semibold">{formatHours(hovered.minutes)}</b> · {formatWeekday(hovered.date)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground text-micro">Less</span>
          {STEPS.map((pct) => (
            <span key={pct} className="size-2.5 rounded-[3px]" style={{ background: tint(pct) }} />
          ))}
          <span className="text-muted-foreground text-micro">More</span>
        </span>
        {/* The pinned week's total survives the pointer leaving the grid. */}
        <span className="text-muted-foreground tabular text-caption">{pinWeek !== null ? `Week of ${formatDateShort(weeks[pinWeek]![0]!.date)} · ${formatHours(weekTotal(pinWeek))}` : ""}</span>
      </div>
    </div>
  );
}
