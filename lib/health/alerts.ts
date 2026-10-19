import "server-only";
import { prisma } from "@/lib/prisma";
import { notifyMany } from "@/lib/notify";
import { formatHoursValue } from "@/lib/format";
import { parseIsoDate } from "@/lib/time/pure";
import { computeHealth } from "@/lib/health/queries";

/**
 * M4.2 — when usage passes a threshold, the project's PM and every C-Level
 * get one DM per threshold per period, guarded by the UNIQUE row in
 * `project_alerts`. If the budget is raised and usage falls back under a
 * threshold, its row is removed so it can fire again. Idempotent: safe after
 * every time-log change and from the scheduled job.
 */
export async function checkBudgetAlerts(projectIds: string[]): Promise<{ sent: number }> {
  if (projectIds.length === 0) return { sent: 0 };
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, status: { in: ["active", "on_hold"] } },
    select: { id: true, code: true, name: true, pmId: true, contractType: true, startDate: true, budget: true },
  });
  const health = await computeHealth(projects);
  const cLevel = (await prisma.profile.findMany({ where: { role: "c_level", status: "active" }, select: { id: true } })).map((p) => p.id);
  let sent = 0;

  for (const p of projects) {
    const h = health.get(p.id);
    if (!h || h.current.pct === null) continue;
    const periodStart = parseIsoDate(h.periodStart);
    const passed = new Set(h.current.passedThresholds);

    // Re-arm thresholds the project is back under (M4.2).
    await prisma.projectAlert.deleteMany({
      where: { projectId: p.id, periodStart, threshold: { notIn: [...passed] } },
    });

    for (const threshold of passed) {
      const inserted = await prisma.projectAlert.createMany({
        data: [{ projectId: p.id, periodStart, threshold }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) continue; // already alerted this period
      sent++;
      const period = h.mode === "retainer" ? ` this month` : "";
      await notifyMany([p.pmId, ...cLevel], "budget_threshold", {
        title: `${p.code} passed ${threshold}% of its budget${period}`,
        body: `${p.name}: ${formatHoursValue(h.current.usedHours)} of ${formatHoursValue(h.current.budgetHours ?? 0)} used (${h.current.pct.toFixed(0)}%).`,
        path: `/projects/${p.id}?tab=health`,
        refId: `${p.id}:${h.periodStart}:${threshold}`,
      });
    }
  }
  return { sent };
}
