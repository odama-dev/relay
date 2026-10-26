"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { asUser, requireUser, type CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { parseIsoDate, todayIn } from "@/lib/time/pure";
import { parseCsv } from "@/lib/import/csv";
import { validateDeals, type DealImportRow } from "@/lib/sales/import";
import { dealMoveSchema, dealSchema, stageSchema, uuid } from "@/lib/validation";
import { getDealRecord, type DealRecord } from "@/lib/sales/record";
import { projectForWonDeal, type WonProject } from "@/lib/sales/won";

/**
 * Phase 2 · M9 — pipeline and deals. Writes run under RLS (Sales module);
 * stage rules (probability, closed date, lost reason, history) are the
 * deals_derive / deals_history triggers.
 */

const FORBIDDEN = "Only people with the Sales module manage the pipeline.";

/**
 * A deal just linked to a person / company you've already emailed moves on
 * now, not at the next sync (system half, after the RLS write succeeded).
 */
async function advanceFromMail(d: { personId?: string | null; companyId?: string | null }) {
  if (d.personId || d.companyId) await prisma.$queryRaw`SELECT app.mail_advance_deals(NULL)`;
}

function revalidateSales() {
  revalidatePath("/sales");
  revalidatePath("/sales/report");
  revalidatePath("/dashboard");
}

/** What a won deal needs to become a project (see projectForWonDeal). */
async function wonContext(user: CurrentUser) {
  const settings = await getSettings();
  return { today: todayIn(user.timezone), thresholds: settings.default_alert_thresholds };
}

/** A deal just won became a client and a project: record it and refresh the screens that list them. */
async function afterWon(user: CurrentUser, dealId: string, won: WonProject | null) {
  if (!won) return null;
  if (won.clientCreated) {
    await logActivity({ actorId: user.id, entityType: "client", entityId: won.clientId, action: "created", metadata: { code: won.clientCode, fromDeal: dealId } });
  }
  await logActivity({ actorId: user.id, entityType: "project", entityId: won.id, action: "created", metadata: { code: won.code, fromDeal: dealId } });
  revalidatePath("/clients");
  revalidatePath("/projects");
  revalidatePath("/invoices/new");
  return { id: won.id, code: won.code };
}

export type WonResult = { project: { id: string; code: string } | null };

/**
 * The form's fields, plus the client and prospect name that follow the
 * associated company (a client's company links the deal to that client; the
 * name is what "Add as client" uses when the deal is won).
 */
async function dealData(tx: Prisma.TransactionClient, d: z.output<typeof dealSchema>) {
  const [company, person, stage] = await Promise.all([
    d.companyId ? tx.crmCompany.findUnique({ where: { id: d.companyId }, select: { name: true, clientId: true } }) : null,
    d.personId ? tx.crmPerson.findUnique({ where: { id: d.personId }, select: { name: true } }) : null,
    tx.pipelineStage.findUnique({ where: { id: d.stageId }, select: { category: true, probability: true } }),
  ]);
  if (d.companyId && !company) fail("That company isn't in Companies.");
  if (d.personId && !person) fail("That person isn't in People.");
  if (!stage) fail("Stage not found.");
  return {
    data: {
      title: d.title,
      personId: d.personId ?? null,
      companyId: d.companyId ?? null,
      clientId: company?.clientId ?? null,
      prospectName: company?.clientId ? null : (company?.name ?? person?.name ?? d.title),
      leadDate: parseIsoDate(d.leadDate),
      lastContactOn: d.lastContactOn ? parseIsoDate(d.lastContactOn) : null,
      value: d.value,
      currency: d.currency,
      ownerId: d.ownerId ?? null,
      leadSource: d.leadSource,
      leadType: d.leadType,
      stageId: d.stageId,
      // deals_last_stage keeps an open deal's last stage on its stage.
      ...(stage.category !== "open" && d.lastStageId ? { lastStageId: d.lastStageId } : {}),
      lostReason: d.lostReason ?? null,
    },
    probability: stage.probability,
  };
}

export async function createDeal(raw: unknown): Promise<ActionResult<{ id: string } & WonResult>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.manageDeals(user)) fail(FORBIDDEN);
    const d = parseOrFail(dealSchema, raw);
    const ctx = await wonContext(user);
    const { deal, won } = await asUser(user, async (tx) => {
      const { data, probability } = await dealData(tx, d);
      const deal = await tx.deal.create({ data: { ...data, probability } });
      return { deal, won: await projectForWonDeal(tx, user, deal.id, ctx) };
    });
    await logActivity({ actorId: user.id, entityType: "deal", entityId: deal.id, action: "created", metadata: { title: d.title, value: d.value, currency: d.currency } });
    await advanceFromMail(d);
    revalidateSales();
    return { id: deal.id, project: await afterWon(user, deal.id, won) };
  });
}

export async function updateDeal(id: unknown, raw: unknown): Promise<ActionResult<WonResult>> {
  return run(async () => {
    const user = await requireUser();
    const dealId = parseOrFail(uuid, id);
    const d = parseOrFail(dealSchema, raw);
    const ctx = await wonContext(user);
    const { res, won } = await asUser(user, async (tx) => {
      const current = await tx.deal.findUnique({ where: { id: dealId }, select: { projectId: true, clientId: true } });
      if (!current) fail("Deal not found.");
      const { data } = await dealData(tx, d);
      // Once the deal has its project, the client stays put (deals_derive).
      if (current.projectId) Object.assign(data, { clientId: current.clientId, prospectName: null });
      // A deal linked to a client keeps it when the form has no client's company.
      else if (current.clientId && !data.clientId) Object.assign(data, { clientId: current.clientId, prospectName: null });
      const res = await tx.deal.updateMany({ where: { id: dealId }, data });
      return { res, won: res.count ? await projectForWonDeal(tx, user, dealId, ctx) : null };
    });
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "deal", entityId: dealId, action: "updated" });
    await advanceFromMail(d);
    revalidateSales();
    return { project: await afterWon(user, dealId, won) };
  });
}

/** Drag to a stage. Lost needs a reason (deals_derive); Won makes the client and project. */
export async function moveDeal(id: unknown, raw: unknown): Promise<ActionResult<WonResult>> {
  return run(async () => {
    const user = await requireUser();
    const dealId = parseOrFail(uuid, id);
    const d = parseOrFail(dealMoveSchema, raw);
    const ctx = await wonContext(user);
    const { res, won } = await asUser(user, async (tx) => {
      const res = await tx.deal.updateMany({ where: { id: dealId }, data: { stageId: d.stageId, ...(d.lostReason ? { lostReason: d.lostReason } : {}) } });
      return { res, won: res.count ? await projectForWonDeal(tx, user, dealId, ctx) : null };
    });
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "deal", entityId: dealId, action: "moved", metadata: { stageId: d.stageId } });
    revalidateSales();
    return { project: await afterWon(user, dealId, won) };
  });
}

/** A deal entered by mistake. One that became a project stays (move it to Lost instead). */
export async function deleteDeal(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const dealId = parseOrFail(uuid, id);
    const gone = await asUser(user, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { title: true, projectId: true, value: true, currency: true } });
      if (!deal) fail("Deal not found.");
      if (deal.projectId) fail("This deal became a project. Keep it for the record.");
      const res = await tx.deal.deleteMany({ where: { id: dealId } });
      if (res.count === 0) fail(FORBIDDEN);
      return deal;
    });
    await logActivity({ actorId: user.id, entityType: "deal", entityId: dealId, action: "deleted", metadata: { title: gone.title, value: gone.value.toString(), currency: gone.currency } });
    revalidateSales();
  });
}

/** A deal won before won deals became projects on their own: make its client and project now. */
export async function createProjectFromDeal(id: unknown): Promise<ActionResult<WonResult>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.manageDeals(user) || !perms.createProjects(user)) fail("Only Sales and C-Level turn a won deal into a project.");
    const dealId = parseOrFail(uuid, id);
    const ctx = await wonContext(user);
    const won = await asUser(user, (tx) => projectForWonDeal(tx, user, dealId, ctx));
    if (!won) fail("This deal isn't won, or it already has a project.");
    revalidateSales();
    return { project: await afterWon(user, dealId, won) };
  });
}

// ---------------------------------------------------------------------------
// Stages — each has a category (Open / Won / Lost) and a default probability.
// ---------------------------------------------------------------------------

export async function createStage(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.manageDeals(user)) fail(FORBIDDEN);
    const d = parseOrFail(stageSchema, raw);
    const stage = await asUser(user, async (tx) => {
      const last = await tx.pipelineStage.aggregate({ _max: { position: true } });
      return tx.pipelineStage.create({ data: { ...d, position: (last._max.position ?? -1) + 1 } });
    });
    await logActivity({ actorId: user.id, entityType: "pipeline_stage", entityId: stage.id, action: "created", metadata: d });
    revalidateSales();
  });
}

export async function updateStage(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const stageId = parseOrFail(uuid, id);
    const d = parseOrFail(stageSchema, raw);
    const res = await asUser(user, (tx) => tx.pipelineStage.updateMany({ where: { id: stageId }, data: d }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "pipeline_stage", entityId: stageId, action: "updated", metadata: d });
    revalidateSales();
  });
}

/** Hide a stage from the board and the pickers (its deals still count), or show it again. */
export async function setStageHidden(id: unknown, hidden: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const stageId = parseOrFail(uuid, id);
    const isHidden = parseOrFail(z.boolean(), hidden);
    const res = await asUser(user, (tx) => tx.pipelineStage.updateMany({ where: { id: stageId }, data: { isHidden } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "pipeline_stage", entityId: stageId, action: isHidden ? "hidden" : "shown" });
    revalidateSales();
  });
}

/** Swap with the neighbour on the board. */
export async function moveStage(id: unknown, direction: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const stageId = parseOrFail(uuid, id);
    const dir = parseOrFail(z.union([z.literal(-1), z.literal(1)]), direction);
    await asUser(user, async (tx) => {
      const stages = await tx.pipelineStage.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
      const i = stages.findIndex((s) => s.id === stageId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= stages.length) return;
      [stages[i], stages[j]] = [stages[j]!, stages[i]!];
      for (const [position, s] of stages.entries()) {
        const res = await tx.pipelineStage.updateMany({ where: { id: s.id }, data: { position } });
        if (res.count === 0) fail(FORBIDDEN);
      }
    });
    revalidateSales();
  });
}

/** Refused while deals sit in it, or when it's the last stage of its category (pipeline_stages_guard). */
export async function deleteStage(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const stageId = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.pipelineStage.deleteMany({ where: { id: stageId } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "pipeline_stage", entityId: stageId, action: "deleted" });
    revalidateSales();
  });
}

// ---------------------------------------------------------------------------
// Attio import (PRD "Migrasi") — preview, then import the valid rows under RLS.
// ---------------------------------------------------------------------------

const importInput = z.object({ text: z.string().max(5_000_000), mode: z.enum(["skip", "update"]) });

async function validateImport(user: Awaited<ReturnType<typeof requireUser>>, text: string, mode: "skip" | "update") {
  const settings = await getSettings();
  return asUser(user, async (tx) => {
    const [stages, clients, people, existing] = await Promise.all([
      tx.pipelineStage.findMany({ select: { id: true, name: true } }),
      tx.client.findMany({ select: { id: true, name: true } }),
      tx.profile.findMany({ where: { status: "active" }, select: { id: true, email: true, fullName: true } }),
      tx.deal.findMany({ where: { externalId: { not: null } }, select: { externalId: true } }),
    ]);
    return validateDeals(
      parseCsv(text),
      {
        stages: new Map(stages.map((s) => [s.name.toLowerCase(), s.id])),
        clients: new Map(clients.map((c) => [c.name.toLowerCase(), c.id])),
        people: new Map(people.flatMap((p) => [[p.email.toLowerCase(), p.id] as const, [p.fullName.toLowerCase(), p.id] as const])),
        existing: new Set(existing.map((e) => e.externalId!)),
        currencies: settings.currencies,
      },
      mode,
    );
  });
}

const summary = (rows: DealImportRow[]) => rows.map(({ line, key, action, errors }) => ({ line, key, action, errors }));

export async function previewDealImport(raw: unknown): Promise<ActionResult<{ rows: ReturnType<typeof summary> }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.manageDeals(user)) fail(FORBIDDEN);
    const { text, mode } = parseOrFail(importInput, raw);
    const res = await validateImport(user, text, mode);
    if ("error" in res) fail(res.error);
    return { rows: summary(res.rows) };
  });
}

export async function importDeals(raw: unknown): Promise<ActionResult<{ created: number; updated: number; skipped: number; failed: number }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.manageDeals(user)) fail(FORBIDDEN);
    const { text, mode } = parseOrFail(importInput, raw);
    const res = await validateImport(user, text, mode);
    if ("error" in res) fail(res.error);
    const ready = res.rows.filter((r) => r.data && (r.action === "create" || r.action === "update"));
    await asUser(user, async (tx) => {
      for (const r of ready) {
        const { externalId, createdAt, closedAt, ...fields } = r.data!;
        // A deal imported straight into a stage takes that stage's default probability.
        const stage = await tx.pipelineStage.findUniqueOrThrow({ where: { id: fields.stageId }, select: { probability: true } });
        if (r.action === "update") {
          await tx.deal.update({ where: { externalId: externalId! }, data: { ...fields, ...(closedAt ? { closedAt } : {}) } });
        } else {
          await tx.deal.create({ data: { ...fields, externalId, probability: stage.probability, ...(createdAt ? { createdAt, stageChangedAt: createdAt } : {}), ...(closedAt ? { closedAt } : {}) } });
        }
      }
    });
    const count = (a: string) => res.rows.filter((r) => r.action === a).length;
    const result = { created: count("create"), updated: count("update"), skipped: count("skip"), failed: count("error") };
    await logActivity({ actorId: user.id, entityType: "deal", entityId: user.id, action: "imported", metadata: result });
    revalidateSales();
    return result;
  });
}

/** The deal side panel's data (`?deal=<id>` on the pipeline), read under RLS. */
export async function loadDealRecord(dealId: unknown): Promise<DealRecord> {
  const user = await requireUser();
  const id = uuid.safeParse(dealId);
  if (!id.success || !perms.viewPipeline(user)) throw new Error("Deal not found");
  const record = await getDealRecord(user, id.data);
  if (!record) throw new Error("Deal not found");
  return record;
}
