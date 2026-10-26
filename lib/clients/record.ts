import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { isoDate, todayIn } from "@/lib/time/pure";
import { getSettings } from "@/lib/settings";
import { activePeopleOptions } from "@/lib/people/queries";
import { getClient, type ClientDetail } from "@/lib/clients/queries";
import { getClientSales, type ClientSalesView } from "@/lib/crm/queries";
import { crmMail, type MailView } from "@/lib/mail/queries";

export type ClientRecord = {
  client: ClientDetail;
  /** Deals, people and notes — only for people with the Sales module. */
  sales: ClientSalesView | null;
  mail: MailView[];
  /** The board's visible stages in order, for the deal-stage progress. */
  stages: { name: string; category: string; color: string | null }[];
  nextTask: { id: string; title: string; dueDate: string; projectId: string; projectCode: string } | null;
  viewer: { salesView: boolean; canEdit: boolean; canWriteNotes: boolean; canViewInvoices: boolean; timeZone: string };
  /** What the "New project" form needs; null when the viewer can't add one here. */
  newProject: { pms: { id: string; name: string }[]; thresholds: number[]; today: string; defaultPmId: string; canEditContract: boolean } | null;
};

/** Everything the client panel shows, read under RLS. */
export async function getClientRecord(user: CurrentUser, id: string): Promise<ClientRecord | null> {
  const client = await getClient(user, id);
  if (!client) return null;
  const showSales = perms.viewPipeline(user);
  const sales = showSales ? await getClientSales(user, client.id) : null;
  const canCreateProject = perms.createProjects(user) && !client.isArchived;
  const [mail, stages, task, newProject] = await Promise.all([
    sales ? crmMail(user, { companyId: sales.company?.id, personIds: sales.people.map((p) => p.id) }) : Promise.resolve([]),
    sales
      ? asUser(user, (tx) => tx.pipelineStage.findMany({ where: { isHidden: false }, orderBy: { position: "asc" }, select: { name: true, category: true, color: true } }))
      : Promise.resolve([]),
    asUser(user, (tx) =>
      tx.task.findFirst({
        where: { project: { clientId: client.id }, status: { not: "done" }, dueDate: { not: null } },
        orderBy: { dueDate: "asc" },
        select: { id: true, title: true, dueDate: true, project: { select: { id: true, code: true } } },
      }),
    ),
    canCreateProject
      ? Promise.all([activePeopleOptions(user, ["pm", "c_level"]), getSettings()]).then(([pms, settings]) => ({
          pms,
          thresholds: settings.default_alert_thresholds,
          today: todayIn(user.timezone),
          defaultPmId: user.role === "pm" ? user.id : "",
          canEditContract: perms.editContractValue(user),
        }))
      : Promise.resolve(null),
  ]);
  return {
    client,
    sales,
    mail,
    stages,
    nextTask: task?.dueDate ? { id: task.id, title: task.title, dueDate: isoDate(task.dueDate), projectId: task.project.id, projectCode: task.project.code } : null,
    viewer: {
      salesView: user.role === "sales",
      canEdit: perms.editClients(user),
      canWriteNotes: perms.manageDeals(user),
      canViewInvoices: perms.viewInvoices(user),
      timeZone: user.timezone,
    },
    newProject,
  };
}
