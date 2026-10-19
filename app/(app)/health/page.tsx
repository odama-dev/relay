import { requireAccess, asUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { computeHealth } from "@/lib/health/queries";
import { riskScore } from "@/lib/health/pure";
import { todayIn, parseIsoDate } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { HealthTable, type HealthRow } from "./health-table";

export const metadata = { title: "Project Health" };

/** M4.5 — active projects, most at risk first: health, usage, overdue tasks, out-of-scope waiting. */
export default async function HealthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAccess(perms.viewHealthOverview);
  const sp = await searchParams;
  const pm = typeof sp.pm === "string" ? sp.pm : undefined;
  const client = typeof sp.client === "string" ? sp.client : undefined;
  const today = todayIn(user.timezone);

  const [projects, pms, clients] = await asUser(user, (tx) =>
    Promise.all([
      tx.project.findMany({
        where: { status: "active", ...(pm ? { pmId: pm } : {}), ...(client ? { clientId: client } : {}) },
        include: { budget: true, client: { select: { name: true } }, pm: { select: { fullName: true } } },
      }),
      tx.profile.findMany({ where: { role: { in: ["pm", "c_level"] }, status: "active" }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
      tx.client.findMany({ where: { isArchived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]),
  );
  const ids = projects.map((p) => p.id);
  const [health, overdue, pending] = await Promise.all([
    computeHealth(projects.filter((p) => p.budget), today),
    // Aggregate counts for the overview (PM / C-Level only — guarded above).
    prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { not: "done" }, dueDate: { lt: parseIsoDate(today) }, section: { archivedAt: null } }, _count: true }),
    prisma.timeEntry.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, oosStatus: "pending" }, _sum: { minutes: true }, _count: true }),
  ]);
  const overdueBy = new Map(overdue.map((o) => [o.projectId, o._count]));
  const pendingBy = new Map(pending.map((o) => [o.projectId, o._count]));

  const rows: HealthRow[] = projects
    .map((p) => {
      const h = health.get(p.id)?.current;
      const row = {
        id: p.id,
        code: p.code,
        name: p.name,
        client: p.client?.name ?? "Internal",
        pm: p.pm.fullName,
        retainer: p.contractType === "retainer",
        status: h?.status ?? ("no_budget" as const),
        pct: h?.pct ?? null,
        usedHours: h?.usedHours ?? 0,
        budgetHours: h?.budgetHours ?? null,
        overdueTasks: overdueBy.get(p.id) ?? 0,
        pendingOos: pendingBy.get(p.id) ?? 0,
      };
      return { ...row, risk: riskScore(row) };
    })
    .sort((a, b) => b.risk - a.risk);

  return (
    <div className="flex flex-col">
      <PageHeader title="Project Health" compact />
      <FilterBar
        searchPlaceholder="Search"
        filters={[
          { param: "pm", label: "PM", allLabel: "All PMs", options: pms.map((p) => ({ value: p.id, label: p.fullName })) },
          { param: "client", label: "Client", allLabel: "All clients", options: clients.map((c) => ({ value: c.id, label: c.name })) },
        ]}
      />
      <HealthTable rows={rows} />
    </div>
  );
}
