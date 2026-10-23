"use server";

import { revalidatePath } from "next/cache";
import type { Prisma, ProjectStatus } from "@prisma/client";
import { asUser, requireUser, type CurrentUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { perms } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { freezeRetainerMonths } from "@/lib/health/queries";
import { checkBudgetAlerts } from "@/lib/health/alerts";
import { parseIsoDate } from "@/lib/time/pure";
import { budgetSchema, HR_EVENT_COLORS, PROJECT_STATUSES, projectSchema, uuid, type BudgetInput } from "@/lib/validation";
import { z } from "zod";

const date = (d: string) => parseIsoDate(d);

function budgetData(b: z.output<typeof budgetSchema>, contractType: string | undefined) {
  const retainer = contractType === "retainer";
  return {
    budgetHours: retainer ? null : b.budgetHours,
    retainerHoursPerMonth: retainer ? b.retainerHoursPerMonth : null,
    rolloverMode: retainer ? b.rolloverMode : "none",
    rolloverCapHours: retainer && b.rolloverMode === "capped" ? b.rolloverCapHours : null,
    alertThresholds: [...new Set(b.alertThresholds)].sort((a, c) => a - c),
  } as const;
}

async function assertPm(pmId: string) {
  const pm = await prisma.profile.findUnique({ where: { id: pmId }, select: { status: true, role: true } });
  if (!pm || pm.status !== "active") fail("Choose an active PM.");
  if (pm.role !== "pm" && pm.role !== "c_level") fail("The PM must be a Project Manager or C-Level.");
}

function revalidateProject(id?: string) {
  revalidatePath("/projects");
  if (id) revalidatePath(`/projects/${id}`);
}

/** M1.2 — create a client or internal project. Code, PM membership and the General section come from triggers. */
/**
 * `fromDeal` (Phase 2 · M9): a won deal becomes this project — linked in the
 * same transaction, so a deal that isn't won (deals_derive) creates nothing.
 */
export async function createProject(raw: unknown, fromDeal?: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.createProjects(user)) fail("Only PMs, Sales and C-Level create projects.");
    const d = parseOrFail(projectSchema, raw);
    const dealId = fromDeal === undefined ? null : parseOrFail(uuid, fromDeal);
    await assertPm(d.pmId);
    const isClient = d.kind === "client";

    const project = await asUser(user, async (tx) => {
      if (isClient) {
        const client = await tx.client.findUnique({ where: { id: d.clientId! }, select: { isArchived: true } });
        if (!client) fail("Client not found.");
        if (client.isArchived) fail("This client is archived. Restore it first.");
      }
      const p = await tx.project.create({
        data: {
          name: d.name,
          kind: d.kind,
          clientId: isClient ? d.clientId! : null,
          contractType: isClient ? d.contractType! : null,
          currency: d.currency,
          pmId: d.pmId,
          status: d.status,
          startDate: date(d.startDate),
          endDate: d.endDate ? date(d.endDate) : null,
          links: d.links as Prisma.InputJsonValue,
          createdBy: user.id,
        },
      });
      await tx.projectBudget.create({ data: { projectId: p.id, ...budgetData(d.budget, d.contractType) } });
      if (isClient && perms.editContractValue(user)) {
        await tx.projectContract.create({ data: { projectId: p.id, contractValue: d.contractValue ?? null, retainerFeePerMonth: retainerFee(d) } });
      }
      if (dealId) {
        const res = await tx.deal.updateMany({ where: { id: dealId, projectId: null }, data: { projectId: p.id, clientId: p.clientId } });
        if (res.count === 0) fail("This deal already has a project, or you can't change it.");
      }
      return p;
    });

    await logActivity({ actorId: user.id, entityType: "project", entityId: project.id, action: "created", metadata: { code: project.code, ...(dealId ? { fromDeal: dealId } : {}) } });
    if (dealId) revalidatePath("/sales");
    revalidateProject();
    return { id: project.id, code: project.code };
  });
}

/** Only retainers carry a monthly fee. */
const retainerFee = (d: { contractType?: string; retainerFeePerMonth?: number | null }) =>
  d.contractType === "retainer" ? (d.retainerFeePerMonth ?? null) : null;

/** Edit project info (M1.2). Kind and client are fixed after creation. */
export async function updateProject(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const projectId = parseOrFail(uuid, id);
    const d = parseOrFail(projectSchema, raw);
    const before = await asUser(user, (tx) => tx.project.findUnique({ where: { id: projectId } }));
    if (!before) fail("Project not found.");
    if (d.pmId !== before.pmId) await assertPm(d.pmId);

    await asUser(user, async (tx) => {
      const res = await tx.project.updateMany({
        where: { id: projectId },
        data: {
          name: d.name,
          contractType: before.kind === "client" ? d.contractType! : null,
          currency: d.currency,
          pmId: d.pmId,
          status: d.status,
          startDate: date(d.startDate),
          endDate: d.endDate ? date(d.endDate) : null,
          links: d.links as Prisma.InputJsonValue,
        },
      });
      if (res.count === 0) fail("You can't edit this project.");
      if (before.kind === "client" && perms.editContractValue(user)) {
        await tx.projectContract.upsert({
          where: { projectId },
          create: { projectId, contractValue: d.contractValue ?? null, retainerFeePerMonth: retainerFee(d) },
          update: { contractValue: d.contractValue ?? null, retainerFeePerMonth: retainerFee(d) },
        });
      }
    });
    await logActivity({ actorId: user.id, entityType: "project", entityId: projectId, action: "updated" });
    revalidateProject(projectId);
  });
}

/**
 * M1.3 / M4.2 — hour budget, retainer rollover and alert thresholds. A
 * retainer change applies from the current month: past months are frozen
 * with the old settings first.
 */
export async function updateBudget(id: unknown, raw: BudgetInput): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const projectId = parseOrFail(uuid, id);
    const b = parseOrFail(budgetSchema, raw);
    const project = await asUser(user, (tx) =>
      tx.project.findUnique({ where: { id: projectId }, select: { contractType: true, budget: { select: { projectId: true } } } }),
    );
    if (!project) fail("Project not found.");
    if (project.contractType === "retainer" && !(b.retainerHoursPerMonth && b.retainerHoursPerMonth > 0)) {
      fail("Set the hours per month.");
    }

    await freezeRetainerMonths(projectId);
    const data = budgetData(b, project.contractType ?? undefined);
    await asUser(user, async (tx) => {
      if (project.budget) {
        const res = await tx.projectBudget.updateMany({ where: { projectId }, data });
        if (res.count === 0) fail("Only the project's PM or C-Level can change the budget.");
      } else {
        await tx.projectBudget.create({ data: { projectId, ...data } });
      }
    });
    await logActivity({ actorId: user.id, entityType: "project", entityId: projectId, action: "budget_updated", metadata: data });
    // A raised budget can re-arm thresholds; a lowered one may cross them now (M4.2).
    await checkBudgetAlerts([projectId]);
    revalidateProject(projectId);
  });
}

/** M1.5 — Active, On hold, Completed, Archived. */
export async function setProjectStatus(id: unknown, status: ProjectStatus): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const projectId = parseOrFail(uuid, id);
    if (!PROJECT_STATUSES.includes(status)) fail("Unknown status.");
    const res = await asUser(user, (tx) => tx.project.updateMany({ where: { id: projectId }, data: { status } }));
    if (res.count === 0) fail("You can't change this project.");
    await logActivity({ actorId: user.id, entityType: "project", entityId: projectId, action: "status_changed", metadata: { status } });
    revalidateProject(projectId);
  });
}

/** A project's dot on the calendars — whoever may edit the project (its PM, Sales, C-Level). */
export async function setProjectColor(id: unknown, color: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const projectId = parseOrFail(uuid, id);
    const calendarColor = parseOrFail(z.enum(HR_EVENT_COLORS), color);
    const res = await asUser(user, (tx) => tx.project.updateMany({ where: { id: projectId }, data: { calendarColor } }));
    if (res.count === 0) fail("You can't change this project.");
    await logActivity({ actorId: user.id, entityType: "project", entityId: projectId, action: "color_changed", metadata: { color: calendarColor } });
    revalidatePath("/dashboard");
  });
}

async function memberAction(user: CurrentUser, projectId: string, fn: () => Promise<unknown>) {
  await fn();
  revalidateProject(projectId);
}

/** M1.4 — the project's PM or C-Level adds people (active only — trigger-enforced). */
export async function addMembers(id: unknown, userIds: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const projectId = parseOrFail(uuid, id);
    const ids = parseOrFail(z.array(uuid).min(1).max(50), userIds);
    await memberAction(user, projectId, () =>
      asUser(user, async (tx) => {
        for (const userId of ids) {
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId, userId } },
            create: { projectId, userId, addedBy: user.id },
            update: {},
          });
        }
      }),
    );
    await logActivity({ actorId: user.id, entityType: "project", entityId: projectId, action: "members_added", metadata: { userIds: ids } });
  });
}

/** Removed members stay in task, comment and time history (M1.4). */
export async function removeMember(id: unknown, memberId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const projectId = parseOrFail(uuid, id);
    const userId = parseOrFail(uuid, memberId);
    await memberAction(user, projectId, async () => {
      const res = await asUser(user, (tx) => tx.projectMember.deleteMany({ where: { projectId, userId } }));
      if (res.count === 0) fail("Only the project's PM or C-Level can remove members.");
    });
    await logActivity({ actorId: user.id, entityType: "project", entityId: projectId, action: "member_removed", metadata: { userId } });
  });
}

/** Default thresholds for the create form (M0.5). */
export async function defaultThresholds(): Promise<number[]> {
  return (await getSettings()).default_alert_thresholds;
}
