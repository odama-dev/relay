import { asUser, requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { isoDate } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { JobRolesPanel } from "./job-roles-panel";
import { TaskTypesPanel } from "./task-types-panel";
import { HolidaysPanel } from "./holidays-panel";

export const metadata = { title: "People Setup" };

/** Phase 2 · M6 — the People module's catalogue: job roles, task types, holidays. */
export default async function PeopleSetupPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAccess(perms.managePeopleModule);
  const [{ tab }, data] = await Promise.all([
    searchParams,
    asUser(user, async (tx) => ({
      jobRoles: await tx.jobRole.findMany({
        orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { division: "asc" }, { level: "asc" }, { name: "asc" }],
        include: { _count: { select: { people: true } } },
      }),
      taskTypes: await tx.taskType.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { _count: { select: { tasks: true } } } }),
      holidays: await tx.publicHoliday.findMany({ orderBy: { date: "asc" } }),
    })),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="People Setup" description="Job roles, task types and holidays used for KPIs, capacity and review SLAs." />
      <EntityTabs
        initial={tab}
        items={[
          {
            value: "job-roles",
            label: "Job roles",
            count: data.jobRoles.filter((r) => !r.archivedAt).length,
            content: (
              <JobRolesPanel
                roles={data.jobRoles.map((r) => ({
                  id: r.id,
                  name: r.name,
                  division: r.division,
                  level: r.level,
                  defaultAccess: r.defaultAccess,
                  defaultModules: r.defaultModules,
                  hasOkr: r.hasOkr,
                  archived: Boolean(r.archivedAt),
                  people: r._count.people,
                }))}
              />
            ),
          },
          {
            value: "task-types",
            label: "Task types",
            count: data.taskTypes.filter((t) => !t.archivedAt).length,
            content: (
              <TaskTypesPanel
                types={data.taskTypes.map((t) => ({ id: t.id, name: t.name, key: t.key, archived: Boolean(t.archivedAt), usage: t._count.tasks }))}
              />
            ),
          },
          {
            value: "holidays",
            label: "Holidays",
            count: data.holidays.length,
            content: <HolidaysPanel holidays={data.holidays.map((h) => ({ date: isoDate(h.date), name: h.name }))} />,
          },
        ]}
      />
    </div>
  );
}
