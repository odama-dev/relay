import "server-only";
import type { ScorePeriod } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { hasModule } from "@/lib/roles";
import { isoDate, type IsoDate } from "@/lib/time/pure";
import { computeKpi, kpiContext, type KpiComputation } from "@/lib/kpi/engine";
import type { ItemResult } from "@/lib/kpi/pure";

/** May the viewer see this person's KPI? Decided by RLS (app.can_view_kpi). */
export async function canViewKpi(user: CurrentUser, subjectId: string): Promise<boolean> {
  const r = await asUser(user, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app.can_view_kpi(${subjectId}::uuid) AS ok`);
  return r[0]?.ok ?? false;
}

export type KpiPerson = { id: string; name: string; avatarUrl: string | null; jobRole: string | null; managerId: string | null };

/** People whose KPI the viewer may open: themselves, their reports (any depth), or everyone with People / Studio Report. */
export async function kpiPeople(user: CurrentUser): Promise<KpiPerson[]> {
  return asUser(user, async (tx) => {
    const all = await tx.profile.findMany({
      where: { status: "active" },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, avatarUrl: true, managerId: true, jobRole: { select: { name: true } } },
    });
    const everyone = hasModule(user, "people", "studio_report");
    const reports = new Set<string>([user.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of all) {
        if (p.managerId && reports.has(p.managerId) && !reports.has(p.id)) {
          reports.add(p.id);
          grew = true;
        }
      }
    }
    return all
      .filter((p) => everyone || reports.has(p.id))
      .map((p) => ({ id: p.id, name: p.fullName, avatarUrl: p.avatarUrl, jobRole: p.jobRole?.name ?? null, managerId: p.managerId }));
  });
}

export type KpiHistoryRow = { id: string; periodKind: ScorePeriod; periodStart: IsoDate; periodEnd: IsoDate; score: number | null; grade: string | null; calibration: boolean; computedAt: Date; items: ItemResult[]; objections: { id: string; status: string; reason: string; decisionNote: string | null }[] };

/** One person's KPI: live for the chosen period, plus recorded results (snapshots). */
export async function loadPersonKpi(user: CurrentUser, subjectId: string, periodKind: ScorePeriod, day: IsoDate): Promise<{ live: KpiComputation; history: KpiHistoryRow[] } | null> {
  if (!(await canViewKpi(user, subjectId))) return null;
  const [live, history] = await Promise.all([
    // The engine reads the person's rows on the system connection; access was proven just above.
    computeKpi(subjectId, periodKind, day),
    asUser(user, (tx) =>
      tx.kpiResult.findMany({
        where: { userId: subjectId },
        orderBy: { periodStart: "desc" },
        take: 24,
        include: { objections: { select: { id: true, status: true, reason: true, decisionNote: true } } },
      }),
    ),
  ]);
  return {
    live,
    history: history.map((r) => ({
      id: r.id,
      periodKind: r.periodKind,
      periodStart: isoDate(r.periodStart),
      periodEnd: isoDate(r.periodEnd),
      score: r.score == null ? null : Number(r.score),
      grade: r.grade,
      calibration: r.calibration,
      computedAt: r.computedAt,
      items: r.items as unknown as ItemResult[],
      objections: r.objections,
    })),
  };
}

/** Everyone the viewer may see, scored live for the month (team and studio views). */
export async function loadTeamKpi(user: CurrentUser, day: IsoDate) {
  const people = (await kpiPeople(user)).filter((p) => p.id !== user.id);
  const ctx = await kpiContext();
  const rows = await Promise.all(people.map(async (p) => ({ person: p, kpi: await computeKpi(p.id, "monthly", day, ctx) })));
  return rows;
}
