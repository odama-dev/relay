"use client";

import type { HrOccurrence } from "@/lib/hr/pure";
import { formatDateShort, formatWeekday } from "@/lib/format";
import { CardGroupLabel, CardList, cardRowClass, panelSection, panelSections } from "@/components/dashboard-card";
import { cn } from "@/lib/utils";
import { eventTone } from "./event-tone";


/** When, on one line: "until 24 Oct" / "10:00–10:30" / "All day" today; "25–27 Oct" / "Mon 26 Oct · 10:00" later. */
function when(o: HrOccurrence, today: string) {
  if (o.startDate <= today) return !o.allDay ? `${o.startTime}–${o.endTime}` : o.endDate > today ? `until ${formatDateShort(o.endDate)}` : "All day";
  if (o.endDate > o.startDate) return o.startDate.slice(0, 7) === o.endDate.slice(0, 7) ? `${Number(o.startDate.slice(8, 10))}–${formatDateShort(o.endDate)}` : `${formatDateShort(o.startDate)} – ${formatDateShort(o.endDate)}`;
  return o.allDay ? formatWeekday(o.startDate) : `${formatWeekday(o.startDate)} · ${o.startTime}`;
}

function EventRow({ o, today }: { o: HrOccurrence; today: string }) {
  const tone = eventTone(o.color);
  return (
    <li className={cn(cardRowClass, "py-1.5")} title={o.notes ?? undefined}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
      <span className="min-w-0 flex-1 truncate">{o.title}</span>
      <span className="text-muted-foreground tabular shrink-0 whitespace-nowrap text-caption">{when(o, today)}</span>
    </li>
  );
}

function Section({ label, events, empty, today }: { label: string; events: HrOccurrence[]; empty: string; today: string }) {
  return (
    <div className={panelSection}>
      <CardGroupLabel label={label} count={events.length || undefined} />
      {events.length === 0 ? <p className="text-muted-foreground py-1 text-body">{empty}</p> : <CardList>{events.map((o) => <EventRow key={o.key} o={o} today={today} />)}</CardList>}
    </div>
  );
}

/** HR's agenda: today's events, the coming week, then the rest of the month. */
export function AgendaList({ today, events, upcoming, later }: { today: string; events: HrOccurrence[]; upcoming: HrOccurrence[]; later: HrOccurrence[] }) {
  return (
    <div className={panelSections}>
      <Section label="Today" events={events} empty="Nothing on the calendar today." today={today} />
      <Section label="Next 7 days" events={upcoming} empty="Nothing coming up." today={today} />
      {later.length > 0 && <Section label="Later this month" events={later} empty="" today={today} />}
    </div>
  );
}
