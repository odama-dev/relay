import { asUser, requireUser } from "@/lib/auth";
import { hasModule, perms } from "@/lib/roles";
import { loadOkr } from "@/lib/kpi/okr";
import { formatDate } from "@/lib/format";
import { monthStart, todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { EmptyState } from "@/components/states";
import { ParamSelect } from "@/components/param-select";
import { WarningList } from "@/components/warning-list";
import { ObjectivesTable } from "@/components/okr/objectives-table";
import { NewObjectiveButton } from "@/components/okr/new-objective-button";

export const metadata = { title: "OKR" };

/**
 * PRD Phase 2 "OKR": quarterly objectives with monthly check-ins. Studio
 * objectives come from Studio Report; teams' are approved by HR. OKRs don't
 * affect reward.
 */
export default async function OkrPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayIn(user.timezone);
  const data = await loadOkr(user, typeof sp.cycle === "string" ? sp.cycle : undefined, today);
  if (!data.cycle) {
    return (
      <div className="flex flex-col">
        <PageHeader title="OKR" compact />
        <EmptyState icon="target" title="No OKR cycle yet" description="HR or Studio Report opens a quarter in the KPI & OKR builder." />
      </div>
    );
  }
  const cycle = data.cycle;
  const [options, reports] = await Promise.all([
    asUser(user, async (tx) => ({
      people: (await tx.profile.findMany({ where: { status: "active" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, avatarUrl: true } })).map((p) => ({ id: p.id, name: p.fullName, avatarUrl: p.avatarUrl })),
      metrics: await tx.metric.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tasks: (
        await tx.task.findMany({
          where: { status: { not: "done" }, OR: [{ ownerId: user.id }, { collaborators: { some: { userId: user.id } } }] },
          select: { id: true, title: true, project: { select: { code: true } } },
          take: 200,
        })
      ).map((t) => ({ id: t.id, label: `${t.project.code} · ${t.title}` })),
    })),
    asUser(user, (tx) => tx.profile.findMany({ where: { managerId: user.id }, select: { id: true } })),
  ]);
  const okrOptions = { ...options, studio: data.objectives.filter((o) => o.isStudio).map((o) => ({ id: o.id, title: o.title })), canStudio: hasModule(user, "studio_report") };
  const canApprove = perms.managePeopleModule(user);
  const teamIds = new Set(reports.map((r) => r.id));
  const month = monthStart(today);
  const table = (rows: typeof data.objectives) => (
    <ObjectivesTable rows={rows} cycleId={cycle.id} viewerId={user.id} month={month} options={okrOptions} canApprove={canApprove} />
  );
  const team = data.objectives.filter((o) => !o.isStudio && o.owners.some((w) => teamIds.has(w.id)));
  const proposed = data.objectives.filter((o) => o.status === "proposed");

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`OKR · ${cycle.name}`}
        compact
        actions={
          <>
            <ParamSelect
              param="cycle"
              value={cycle.id}
              defaultValue={data.cycles.find((c) => c.status === "active")?.id ?? cycle.id}
              ariaLabel="Cycle"
              options={data.cycles.map((c) => ({ value: c.id, label: `${c.name} · ${formatDate(c.startDate)} – ${formatDate(c.endDate)}` }))}
            />
            {cycle.status !== "closed" && <NewObjectiveButton cycleId={cycle.id} viewerId={user.id} options={okrOptions} />}
          </>
        }
      />
      <WarningList warnings={data.warnings} />
      <EntityTabs
        variant="toolbar"
        initial={typeof sp.tab === "string" ? sp.tab : undefined}
        items={[
          { value: "mine", label: "Mine", count: data.objectives.filter((o) => o.isOwner && !o.isStudio).length || undefined, content: table(data.objectives.filter((o) => o.isOwner && !o.isStudio)) },
          { value: "studio", label: "Studio", count: data.objectives.filter((o) => o.isStudio).length || undefined, content: table(data.objectives.filter((o) => o.isStudio)) },
          ...(team.length ? [{ value: "team", label: "My team", count: team.length, content: table(team) }] : []),
          { value: "all", label: "Everyone", content: table(data.objectives.filter((o) => !o.isStudio)) },
          ...(canApprove ? [{ value: "approve", label: "To approve", count: proposed.length || undefined, content: table(proposed) }] : []),
        ]}
      />
    </div>
  );
}
