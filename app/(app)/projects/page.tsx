import { requireUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { clientOptions, listProjects, parseProjectFilters } from "@/lib/projects/queries";
import { activePeopleOptions } from "@/lib/people/queries";
import { getSettings } from "@/lib/settings";
import { todayIn } from "@/lib/time/pure";
import { CONTRACT_TYPES, PROJECT_STATUSES } from "@/lib/validation";
import { sentenceEnum } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/states";
import { ProjectsTable } from "./projects-table";
import { AddProjectButton } from "./add-project-button";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const filters = parseProjectFilters(await searchParams);
  const canCreate = perms.createProjects(user);
  const [rows, clients, pms, settings] = await Promise.all([
    listProjects(user, filters),
    perms.viewClients(user) ? clientOptions(user) : Promise.resolve([]),
    activePeopleOptions(user, ["pm", "c_level"]),
    getSettings(),
  ]);

  const addButton = canCreate ? (
    <AddProjectButton
      clients={clients}
      pms={pms}
      canEditContract={perms.editContractValue(user)}
      defaultPmId={user.role === "pm" ? user.id : ""}
      defaultThresholds={settings.default_alert_thresholds}
      today={todayIn(user.timezone)}
    />
  ) : null;
  const filtered = Boolean(filters.q || filters.status || filters.clientId || filters.pmId || filters.contractType);

  return (
    <div className="flex flex-col">
      <PageHeader title="Projects" compact actions={addButton} />
      {rows.length === 0 && !filtered ? (
        <EmptyState
          icon="projects"
          title="No projects yet"
          description={canCreate ? "Create a project, or import them from CSV in Settings." : "You'll see the projects you're added to here."}
          action={addButton}
        />
      ) : (
        <>
          <FilterBar
            searchPlaceholder="Search code, name or client"
            filters={[
              {
                param: "status",
                label: "Status",
                allLabel: "Open projects",
                options: PROJECT_STATUSES.map((s) => ({ value: s, label: sentenceEnum(s) })),
              },
              ...(clients.length > 0
                ? [{ param: "client", label: "Client", allLabel: "All clients", options: clients.map((c) => ({ value: c.id, label: c.name })) }]
                : []),
              { param: "pm", label: "PM", allLabel: "All PMs", options: pms.map((p) => ({ value: p.id, label: p.name })) },
              {
                param: "contract",
                label: "Contract",
                allLabel: "All contracts",
                options: CONTRACT_TYPES.map((c) => ({ value: c, label: c === "time_and_material" ? "Time & material" : sentenceEnum(c) })),
              },
            ]}
          />
          <ProjectsTable rows={rows} />
        </>
      )}
    </div>
  );
}
