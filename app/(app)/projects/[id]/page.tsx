import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getProject, clientOptions } from "@/lib/projects/queries";
import { getProjectBoard } from "@/lib/tasks/queries";
import { healthBreakdown, monthEnd } from "@/lib/health/queries";
import { listChangeRequests } from "@/lib/health/change-requests";
import { listInvoices } from "@/lib/invoices/queries";
import { activePeopleOptions } from "@/lib/people/queries";
import { asUser } from "@/lib/auth";
import { isIsoDate } from "@/lib/time/pure";
import { sentenceEnum } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EntityTabs, type EntityTab } from "@/components/entity-tabs";
import { StatusBadge } from "@/components/status-badge";
import { HealthIndicator } from "@/components/health-indicator";
import { ProjectTaskBoard } from "@/components/tasks/project-task-board";
import { upcomingLeave } from "@/lib/dashboard/phase2";
import { TaskPanel } from "@/components/tasks/task-panel";
import { HealthPanel } from "@/components/health/health-panel";
import { InvoicesTable } from "@/components/invoice/invoices-table";
import { PillButton } from "@/components/pill-button";
import { LogTimeButton } from "@/components/time/log-time-dialog";
import { EmptyState } from "@/components/states";
import { OverviewPanel } from "./overview-panel";
import { ChangeRequestsPanel } from "./change-requests-panel";
import { ProjectHeaderActions } from "./project-header-actions";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const project = await getProject(user, id);
  if (!project) notFound();
  const v = project.viewer;
  const tab = typeof sp.tab === "string" ? sp.tab : undefined;
  const crFrom = typeof sp.crfrom === "string" && isIsoDate(sp.crfrom) ? sp.crfrom : undefined;
  const crTo = typeof sp.crto === "string" && isIsoDate(sp.crto) ? sp.crto : undefined;
  const canSeeChangeRequests = v.canManage || (user.role === "pm" && v.isMember);

  const [board, people, invoices, changeRequests, breakdown, editOptions] = await Promise.all([
    v.canSeeTasks ? getProjectBoard(user, id) : null,
    v.canManage ? activePeopleOptions(user) : Promise.resolve([]),
    v.canSeeInvoices ? listInvoices(user, { projectId: id }) : null,
    canSeeChangeRequests ? listChangeRequests(user, id, crFrom, crTo) : null,
    v.canSeeHealthBreakdown && project.health
      ? healthBreakdown(id, project.health.periodStart, project.health.mode === "retainer" ? monthEnd(project.health.periodStart) : undefined)
      : null,
    v.canEdit
      ? Promise.all([perms.viewClients(user) ? clientOptions(user) : Promise.resolve([]), activePeopleOptions(user, ["pm", "c_level"])])
      : null,
  ]);
  const avatars = v.canManage
    ? await asUser(user, (tx) => tx.profile.findMany({ where: { id: { in: people.map((p) => p.id) } }, select: { id: true, avatarUrl: true } }))
    : [];
  const avatarOf = new Map(avatars.map((a) => [a.id, a.avatarUrl]));
  // PRD "Cuti & kapasitas": warn when a new task falls due on its owner's leave.
  const leave = board && v.canManage ? await upcomingLeave(user, project.members.map((m) => m.id)) : [];

  const tabs: EntityTab[] = [];
  if (board) {
    tabs.push({
      value: "tasks",
      label: "Tasks",
      count: board.tasks.filter((t) => t.status !== "done").length,
      content: (
        <ProjectTaskBoard
          projectId={id}
          sections={board.sections}
          tasks={board.tasks}
          types={board.types}
          reviewers={board.reviewers}
          leave={leave}
          members={project.members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl }))}
          viewerId={user.id}
          canManage={v.canManage}
          canCreate={v.canCreateTasks}
        />
      ),
    });
  }
  tabs.push({
    value: "overview",
    label: "Overview",
    content: <OverviewPanel project={project} people={people.map((p) => ({ id: p.id, name: p.name, avatarUrl: avatarOf.get(p.id) ?? null }))} />,
  });
  if (project.health && project.budget && perms.showHealth(user)) {
    tabs.push({
      value: "health",
      label: "Health",
      content: (
        <HealthPanel
          projectId={id}
          health={project.health}
          retainer={project.contractType === "retainer"}
          canEditBudget={v.canEditBudget}
          budget={project.budget}
          breakdown={breakdown}
        />
      ),
    });
  }
  if (changeRequests) {
    tabs.push({
      value: "change-requests",
      label: "Change requests",
      count: changeRequests.length || undefined,
      content: <ChangeRequestsPanel projectId={id} rows={changeRequests} from={crFrom} to={crTo} canMark={v.canManage} />,
    });
  }
  if (invoices) {
    tabs.push({
      value: "invoices",
      label: "Invoices",
      count: invoices.length || undefined,
      content:
        invoices.length === 0 ? (
          <EmptyState
            icon="invoices"
            title="No invoices yet"
            action={v.canCreateInvoice ? <PillButton href={`/invoices/new?project=${id}`}>Create invoice</PillButton> : null}
          />
        ) : (
          <InvoicesTable rows={invoices} hideProject canEditStatus={perms.editInvoices(user)} />
        ),
    });
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={project.name}
        eyebrow={
          <span className="text-muted-foreground flex items-center gap-1.5 text-caption">
            <Link href="/projects" className="hover:text-foreground">
              Projects
            </Link>
            <span>/</span>
            <span className="tabular">{project.code}</span>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-3 text-body">
            <StatusBadge value={project.status} />
            <span className="text-muted-foreground">
              {project.client?.name ?? "Internal"} · PM {project.pm.name}
              {project.contractType && ` · ${project.contractType === "time_and_material" ? "Time & material" : sentenceEnum(project.contractType)}`}
            </span>
            {project.health && perms.showHealth(user) && <HealthIndicator health={project.health.current} />}
          </div>
        }
        actions={
          <>
            {v.loggable && v.canSeeTasks && <LogTimeButton />}
            {v.canCreateInvoice && (
              <PillButton icon="invoices" variant="tertiary" href={`/invoices/new?project=${id}`}>
                Create invoice
              </PillButton>
            )}
            {v.canEdit && editOptions && <ProjectHeaderActions project={project} clients={editOptions[0]} pms={editOptions[1]} canEditContract={v.canEditContract} />}
          </>
        }
      />
      <EntityTabs items={tabs} initial={tab} />
      {board && <TaskPanel />}
    </div>
  );
}
