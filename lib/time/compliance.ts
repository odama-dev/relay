import "server-only";
import type { UserRole } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isoDate, isoWeekday, parseIsoDate, weekDays, weekStart, type IsoDate } from "@/lib/time/pure";

export type ComplianceRow = { id: string; name: string; role: UserRole; days: { date: IsoDate; minutes: number; missing: boolean }[]; total: number; missingDays: number };

/**
 * M3.7 — required loggers (everyone active except C-Level) × the week's
 * workdays, with hours per day and empty days flagged. HR / C-Level read
 * all time (RLS).
 */
export async function getCompliance(user: CurrentUser, anyDay: IsoDate, today: IsoDate, role?: UserRole) {
  const start = weekStart(anyDay);
  const settings = await getSettings();
  const days = weekDays(start).filter((d) => settings.workdays.includes(isoWeekday(d)));
  const [people, entries] = await asUser(user, (tx) =>
    Promise.all([
      tx.profile.findMany({
        where: { status: "active", role: role ? role : { not: "c_level" } },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, role: true },
      }),
      tx.timeEntry.groupBy({
        by: ["userId", "entryDate"],
        where: { entryDate: { gte: parseIsoDate(start), lte: parseIsoDate(weekDays(start)[6]!) } },
        _sum: { minutes: true },
      }),
    ]),
  );
  const minutesOf = new Map(entries.map((e) => [`${e.userId}:${isoDate(e.entryDate)}`, e._sum.minutes ?? 0]));
  const rows: ComplianceRow[] = people
    .filter((p) => p.role !== "c_level")
    .map((p) => {
      const ds = days.map((d) => {
        const minutes = minutesOf.get(`${p.id}:${d}`) ?? 0;
        return { date: d, minutes, missing: minutes === 0 && d <= today };
      });
      return { id: p.id, name: p.fullName, role: p.role, days: ds, total: ds.reduce((s, d) => s + d.minutes, 0), missingDays: ds.filter((d) => d.missing).length };
    });
  return { weekStart: start, days, rows };
}
