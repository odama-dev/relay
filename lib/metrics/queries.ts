import "server-only";
import type { Tx } from "@/lib/db";
import { isoDate, parseIsoDate, type IsoDate } from "@/lib/time/pure";

/** Public holidays in [from, to], for capacity (read in the caller's RLS transaction). */
export async function holidaySet(tx: Tx, from: IsoDate, to: IsoDate): Promise<Set<IsoDate>> {
  const rows = await tx.publicHoliday.findMany({ where: { date: { gte: parseIsoDate(from), lte: parseIsoDate(to) } }, select: { date: true } });
  return new Set(rows.map((r) => isoDate(r.date)));
}

/** Capacity inputs per person: contract rows and overrides (leave included). */
export async function capacityInputs(tx: Tx, userIds: string[], to: IsoDate, from: IsoDate) {
  const [capacity, overrides] = await Promise.all([
    tx.personCapacity.findMany({ where: { userId: { in: userIds }, effectiveFrom: { lte: parseIsoDate(to) } }, orderBy: { effectiveFrom: "asc" } }),
    tx.capacityOverride.findMany({
      where: { userId: { in: userIds }, periodStart: { lte: parseIsoDate(to) }, periodEnd: { gte: parseIsoDate(from) } },
      select: { userId: true, kind: true, periodStart: true, periodEnd: true, availableHours: true },
    }),
  ]);
  return {
    capacityOf: (id: string) =>
      capacity.filter((c) => c.userId === id).map((c) => ({ effectiveFrom: isoDate(c.effectiveFrom), weeklyHours: Number(c.weeklyHours) })),
    overridesOf: (id: string) =>
      overrides.filter((o) => o.userId === id).map((o) => ({ start: isoDate(o.periodStart), end: isoDate(o.periodEnd), availableHours: Number(o.availableHours), kind: o.kind })),
  };
}
