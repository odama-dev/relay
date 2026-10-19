import "server-only";
import type { ContractType, Prisma, ProjectKind, ProjectStatus, RolloverMode } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { num } from "@/lib/money";
import { isoDate, todayIn } from "@/lib/time/pure";
import { computeHealth, type ProjectHealth } from "@/lib/health/queries";
import { CONTRACT_TYPES, PROJECT_STATUSES } from "@/lib/validation";

export type ProjectListRow = {
  id: string;
  code: string;
  name: string;
  kind: ProjectKind;
  client: { id: string; name: string } | null;
  pm: { id: string; name: string };
  contractType: ContractType | null;
  status: ProjectStatus;
  /** Null when the viewer may not see the budget (HR). */
  health: Pick<ProjectHealth["current"], "status" | "pct" | "usedHours" | "budgetHours"> | null;
};

export type ProjectFilters = {
  q?: string;
  status?: ProjectStatus;
  clientId?: string;
  pmId?: string;
  contractType?: ContractType;
};

export function parseProjectFilters(sp: Record<string, string | string[] | undefined>): ProjectFilters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = get("status");
  const contract = get("contract");
  return {
    q: get("q")?.trim() || undefined,
    status: PROJECT_STATUSES.includes(status as ProjectStatus) ? (status as ProjectStatus) : undefined,
    clientId: get("client"),
    pmId: get("pm"),
    contractType: CONTRACT_TYPES.includes(contract as ContractType) ? (contract as ContractType) : undefined,
  };
}

const listInclude = {
  client: { select: { id: true, name: true } },
  pm: { select: { id: true, fullName: true } },
  budget: true,
} satisfies Prisma.ProjectInclude;

/** M1.6 — every project the viewer can access (RLS), with its health indicator. */
export async function listProjects(user: CurrentUser, f: ProjectFilters): Promise<ProjectListRow[]> {
  const where: Prisma.ProjectWhereInput = {
    // Archived projects leave the main list but stay searchable (M1.5).
    status: f.status ?? (f.q ? undefined : { not: "archived" }),
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(f.pmId ? { pmId: f.pmId } : {}),
    ...(f.contractType ? { contractType: f.contractType } : {}),
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { code: { contains: f.q, mode: "insensitive" } },
            { client: { name: { contains: f.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const projects = await asUser(user, (tx) =>
    tx.project.findMany({ where, include: listInclude, orderBy: [{ status: "asc" }, { code: "asc" }] }),
  );
  // `budget` is null when RLS hides it from this viewer — no health then.
  const withBudget = projects.filter((p) => p.budget);
  const health = await computeHealth(withBudget);

  return projects.map((p) => {
    const h = p.budget ? health.get(p.id) : undefined;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      kind: p.kind,
      client: p.client,
      pm: { id: p.pm.id, name: p.pm.fullName },
      contractType: p.contractType,
      status: p.status,
      health: h
        ? { status: h.current.status, pct: h.current.pct, usedHours: h.current.usedHours, budgetHours: h.current.budgetHours }
        : null,
    };
  });
}

export type ProjectDetail = Awaited<ReturnType<typeof getProject>>;

/** One project as the viewer may see it, or null (not found / no access). */
export async function getProject(user: CurrentUser, id: string) {
  const data = await asUser(user, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, code: true, name: true, billingEmail: true } },
        pm: { select: { id: true, fullName: true } },
        budget: true,
        contract: true,
        members: {
          include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true, status: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return project;
  });
  if (!data) return null;

  const isMember = data.pmId === user.id || data.members.some((m) => m.userId === user.id);
  const isPm = data.pmId === user.id;
  const health = data.budget ? (await computeHealth([data])).get(data.id) ?? null : null;
  const loggable = data.status === "active" || data.status === "on_hold";

  const links = (data.links ?? {}) as Record<string, string | undefined>;

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    kind: data.kind,
    client: data.client,
    pm: { id: data.pm.id, name: data.pm.fullName },
    contractType: data.contractType,
    currency: data.currency,
    status: data.status,
    startDate: isoDate(data.startDate),
    endDate: data.endDate ? isoDate(data.endDate) : null,
    links: { notion: links.notion, figma: links.figma, drive: links.drive, slack_channel: links.slack_channel },
    contractValue: data.contract ? num(data.contract.contractValue) : undefined,
    retainerFeePerMonth: data.contract ? num(data.contract.retainerFeePerMonth) : undefined,
    budget: data.budget
      ? {
          budgetHours: num(data.budget.budgetHours),
          retainerHoursPerMonth: num(data.budget.retainerHoursPerMonth),
          rolloverMode: data.budget.rolloverMode as RolloverMode,
          rolloverCapHours: num(data.budget.rolloverCapHours),
          alertThresholds: data.budget.alertThresholds,
        }
      : null,
    health,
    members: data.members.map((m) => ({
      id: m.user.id,
      name: m.user.fullName,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.user.role,
      active: m.user.status === "active",
      isPm: m.userId === data.pmId,
    })),
    viewer: {
      isMember,
      isPm,
      canEdit: perms.createProjects(user) && (user.role !== "pm" || isMember),
      canManage: isPm || user.role === "c_level",
      canEditBudget: perms.editBudget(user, isMember),
      canEditContract: perms.editContractValue(user),
      canSeeContract: data.contract !== null,
      canSeeBudget: data.budget !== null,
      canSeeTasks: perms.viewTasks(user) && (isMember || user.role === "c_level"),
      canCreateTasks: perms.createTasks(user) && (isMember || user.role === "c_level"),
      canSeeInvoices: data.kind === "client" && (perms.editInvoices(user) || user.role === "c_level" || (user.role === "pm" && isMember)),
      canCreateInvoice: data.kind === "client" && perms.editInvoices(user) && loggable,
      canSeeHealthBreakdown: isPm || user.role === "c_level",
      loggable,
    },
    today: todayIn(user.timezone),
  };
}

export type ClientOption = { id: string; code: string; name: string; defaultCurrency: string };

/** Live clients for the project form (archived ones can't take new projects — M1.1). */
export async function clientOptions(user: CurrentUser): Promise<ClientOption[]> {
  return asUser(user, (tx) =>
    tx.client.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, defaultCurrency: true },
    }),
  );
}
