"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { asUser, requireUser } from "@/lib/auth";
import { fail, parseOrFail, run, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { perms } from "@/lib/roles";
import { addDays, addMonths, monthStart, parseIsoDate, todayIn } from "@/lib/time/pure";
import { explainMetric, metricDefinitionSchema } from "@/lib/kpi/definition";
import { previewMetric, simulateTemplate } from "@/lib/kpi/engine";
import {
  formRatersSchema,
  metricSaveSchema,
  personAssignmentSchema,
  ratingFormSchema,
  roleTemplatesSchema,
  templateItemsSchema,
  templateMetaSchema,
  uuid,
} from "@/lib/validation";

/** The builder is the People module's (RLS: has_module('people') on every definition table). */
async function requirePeople() {
  const user = await requireUser();
  if (!perms.managePeopleModule(user)) fail("Only the People module can change KPI and OKR definitions.");
  return user;
}

const done = () => {
  revalidatePath("/performance");
  revalidatePath("/kpi");
};

function keyFrom(name: string): string {
  const k = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(k) ? k : `m_${k || "metric"}`;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function saveMetric(id: unknown, raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requirePeople();
    const d = parseOrFail(metricSaveSchema, raw);
    const definition = parseOrFail(metricDefinitionSchema, d.definition);
    const mid = id == null ? null : parseOrFail(uuid, id);
    const data = { name: d.name, description: d.description ?? null, unit: d.unit, direction: d.direction, manual: d.manual || definition.source === "manual", definition: definition as unknown as Prisma.InputJsonValue };
    const row = await asUser(user, async (tx) => {
      if (mid) return tx.metric.update({ where: { id: mid }, data });
      let key = keyFrom(d.name);
      while (await tx.metric.findUnique({ where: { key }, select: { id: true } })) key = `${keyFrom(d.name)}_${Math.random().toString(36).slice(2, 5)}`;
      return tx.metric.create({ data: { ...data, key, createdBy: user.id } });
    });
    // Results already recorded keep their own copy of each item — past scores never change.
    await logActivity({ actorId: user.id, entityType: "metric", entityId: row.id, action: mid ? "updated" : "created", metadata: { name: d.name, definition: data.definition } });
    done();
    return { id: row.id };
  });
}

export async function setMetricStatus(id: unknown, status: "active" | "archived"): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const mid = parseOrFail(uuid, id);
    await asUser(user, (tx) => tx.metric.update({ where: { id: mid }, data: { status } }));
    await logActivity({ actorId: user.id, entityType: "metric", entityId: mid, action: status === "archived" ? "archived" : "restored" });
    done();
  });
}

/** Preview from real data: last month's actual for every active person. */
export async function previewMetricDefinition(raw: unknown): Promise<ActionResult<{ sentence: string; people: number; withData: number; average: number | null; min: number | null; max: number | null }>> {
  return run(async () => {
    await requirePeople();
    const definition = parseOrFail(metricDefinitionSchema, raw);
    const people = await prisma.profile.findMany({ where: { status: "active" }, select: { id: true } });
    const values = (await previewMetric({ id: randomUUID(), definition } as never, people.map((p) => p.id))).map((v) => v.actual).filter((v): v is number => v !== null);
    const avg = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null;
    return { sentence: explainMetric(definition), people: people.length, withData: values.length, average: avg, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
  });
}

// ---------------------------------------------------------------------------
// KPI templates (versions)
// ---------------------------------------------------------------------------

export async function createTemplate(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requirePeople();
    const d = parseOrFail(templateMetaSchema, raw);
    const row = await asUser(user, (tx) => tx.kpiTemplate.create({ data: { lineageId: randomUUID(), version: 1, name: d.name, kind: d.kind, description: d.description ?? null } }));
    await logActivity({ actorId: user.id, entityType: "kpi_template", entityId: row.id, action: "created", metadata: { name: d.name } });
    done();
    return { id: row.id };
  });
}

/** Edit an active template: copy its latest version into a new draft (one draft at a time). */
export async function newTemplateVersion(lineageId: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requirePeople();
    const lid = parseOrFail(uuid, lineageId);
    const row = await asUser(user, async (tx) => {
      const draft = await tx.kpiTemplate.findFirst({ where: { lineageId: lid, status: "draft" } });
      if (draft) return draft;
      const latest = await tx.kpiTemplate.findFirst({ where: { lineageId: lid }, orderBy: { version: "desc" }, include: { items: true } });
      if (!latest) fail("This template no longer exists.");
      return tx.kpiTemplate.create({
        data: {
          lineageId: lid,
          version: latest.version + 1,
          name: latest.name,
          kind: latest.kind,
          description: latest.description,
          items: {
            create: latest.items.map((i) => ({ metricId: i.metricId, target: i.target, targetPer: i.targetPer, scorePeriod: i.scorePeriod, weight: i.weight, recordOnly: i.recordOnly, tag: i.tag, position: i.position })),
          },
        },
      });
    });
    await logActivity({ actorId: user.id, entityType: "kpi_template", entityId: row.id, action: "version_created", metadata: { version: row.version } });
    done();
    return { id: row.id };
  });
}

export async function saveTemplateDraft(templateId: unknown, meta: unknown, items: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const tid = parseOrFail(uuid, templateId);
    const m = parseOrFail(templateMetaSchema, meta);
    const list = parseOrFail(templateItemsSchema, items);
    await asUser(user, async (tx) => {
      await tx.kpiTemplate.update({ where: { id: tid }, data: { name: m.name, kind: m.kind, description: m.description ?? null } });
      await tx.kpiItem.deleteMany({ where: { templateId: tid } });
      if (list.length) await tx.kpiItem.createMany({ data: list.map((i, position) => ({ ...i, templateId: tid, position })) });
    });
    await logActivity({ actorId: user.id, entityType: "kpi_template", entityId: tid, action: "updated", metadata: { name: m.name, items: list as unknown as Prisma.InputJsonValue } });
    done();
  });
}

/** Draft → active from the start of next month; the version it replaces is archived (kpi_templates_guard). */
export async function activateTemplate(templateId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const tid = parseOrFail(uuid, templateId);
    await asUser(user, async (tx) => {
      const n = await tx.kpiItem.count({ where: { templateId: tid } });
      if (n === 0) fail("Add at least one metric first.");
      await tx.kpiTemplate.update({ where: { id: tid }, data: { status: "active" } });
    });
    await logActivity({ actorId: user.id, entityType: "kpi_template", entityId: tid, action: "activated" });
    done();
  });
}

export async function archiveTemplate(templateId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const tid = parseOrFail(uuid, templateId);
    await asUser(user, (tx) => tx.kpiTemplate.update({ where: { id: tid }, data: { status: "archived" } }));
    await logActivity({ actorId: user.id, entityType: "kpi_template", entityId: tid, action: "archived" });
    done();
  });
}

export async function deleteTemplateDraft(templateId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const tid = parseOrFail(uuid, templateId);
    const res = await asUser(user, (tx) => tx.kpiTemplate.deleteMany({ where: { id: tid, status: "draft" } }));
    if (res.count === 0) fail("Only a draft can be deleted.");
    await logActivity({ actorId: user.id, entityType: "kpi_template", entityId: tid, action: "deleted" });
    done();
  });
}

/** "Simulasi": last month's score for the people the template would apply to (or everyone). */
export async function simulateTemplateAction(templateId: unknown): Promise<ActionResult<{ name: string; score: number | null; grade: string | null; items: { name: string; actual: number | null; target: number | null; score: number | null }[] }[]>> {
  return run(async () => {
    await requirePeople();
    const tid = parseOrFail(uuid, templateId);
    const t = await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: tid }, select: { lineageId: true } });
    const assigned = await prisma.kpiAssignment.findMany({ where: { lineageId: t.lineageId }, select: { userId: true, jobRoleId: true } });
    const people = await prisma.profile.findMany({
      where: {
        status: "active",
        ...(assigned.length ? { OR: [{ id: { in: assigned.map((a) => a.userId).filter((x): x is string => Boolean(x)) } }, { jobRoleId: { in: assigned.map((a) => a.jobRoleId).filter((x): x is string => Boolean(x)) } }] } : {}),
      },
      select: { id: true, fullName: true },
      take: 40,
    });
    const results = await simulateTemplate(tid, people.map((p) => p.id));
    return results.map((r) => ({ name: people.find((p) => p.id === r.userId)!.fullName, score: r.score, grade: r.grade, items: r.items }));
  });
}

// ---------------------------------------------------------------------------
// Assignments — changes apply from the next month
// ---------------------------------------------------------------------------

const nextMonth = () => addMonths(monthStart(todayIn("Asia/Jakarta")), 1);

export async function setRoleTemplates(jobRoleId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const jr = parseOrFail(uuid, jobRoleId);
    const d = parseOrFail(roleTemplatesSchema, raw);
    const starts = nextMonth();
    const wanted = [...d.core.map((l) => ({ lineageId: l, kind: "core" as const })), ...d.addons.map((l) => ({ lineageId: l, kind: "addon" as const }))];
    await asUser(user, async (tx) => {
      const current = await tx.kpiAssignment.findMany({ where: { jobRoleId: jr, OR: [{ endsOn: null }, { endsOn: { gte: parseIsoDate(starts) } }] } });
      for (const a of current) {
        if (wanted.some((w) => w.lineageId === a.lineageId && w.kind === a.kind)) continue;
        // Not started yet → gone; running → ends with this month.
        if (a.startsOn >= parseIsoDate(starts)) await tx.kpiAssignment.delete({ where: { id: a.id } });
        else await tx.kpiAssignment.update({ where: { id: a.id }, data: { endsOn: parseIsoDate(addDays(starts, -1)) } });
      }
      for (const w of wanted) {
        if (current.some((a) => a.lineageId === w.lineageId && a.kind === w.kind)) continue;
        await tx.kpiAssignment.create({ data: { ...w, jobRoleId: jr, startsOn: parseIsoDate(starts), createdBy: user.id } });
      }
    });
    await logActivity({ actorId: user.id, entityType: "job_role", entityId: jr, action: "kpi_templates_set", metadata: { ...d, from: starts } });
    done();
  });
}

export async function addPersonAssignment(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const d = parseOrFail(personAssignmentSchema, raw);
    const row = await asUser(user, (tx) => tx.kpiAssignment.create({ data: { ...d, startsOn: parseIsoDate(nextMonth()), createdBy: user.id } }));
    await logActivity({ actorId: user.id, entityType: "kpi_assignment", entityId: row.id, action: "created", metadata: d });
    done();
  });
}

export async function endAssignment(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const aid = parseOrFail(uuid, id);
    const starts = nextMonth();
    await asUser(user, async (tx) => {
      const a = await tx.kpiAssignment.findUniqueOrThrow({ where: { id: aid } });
      if (a.startsOn >= parseIsoDate(starts)) await tx.kpiAssignment.delete({ where: { id: aid } });
      else await tx.kpiAssignment.update({ where: { id: aid }, data: { endsOn: parseIsoDate(addDays(starts, -1)) } });
    });
    await logActivity({ actorId: user.id, entityType: "kpi_assignment", entityId: aid, action: "ended" });
    done();
  });
}

// ---------------------------------------------------------------------------
// Rating forms
// ---------------------------------------------------------------------------

export async function saveRatingForm(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const d = parseOrFail(ratingFormSchema, raw);
    if (d.raterKind === "job_role" && !d.raterJobRoleId) fail("Pick the job role that rates.");
    const fid = id == null ? null : parseOrFail(uuid, id);
    const data = { metricId: d.metricId, name: d.name, frequency: d.frequency, raterKind: d.raterKind, raterJobRoleId: d.raterJobRoleId ?? null, needsApproval: d.needsApproval };
    const row = await asUser(user, async (tx) => {
      const f = fid ? await tx.ratingForm.update({ where: { id: fid }, data }) : await tx.ratingForm.create({ data });
      const existing = await tx.ratingCriterion.findMany({ where: { formId: f.id }, orderBy: { position: "asc" } });
      // Keep criterion ids where the position stays, so answers already given still line up.
      for (const [i, c] of d.criteria.entries()) {
        const at = existing[i];
        if (at) await tx.ratingCriterion.update({ where: { id: at.id }, data: { title: c.title, scale: c.scale, position: i } });
        else await tx.ratingCriterion.create({ data: { formId: f.id, title: c.title, scale: c.scale, position: i } });
      }
      if (existing.length > d.criteria.length) await tx.ratingCriterion.deleteMany({ where: { id: { in: existing.slice(d.criteria.length).map((c) => c.id) } } });
      return f;
    });
    await logActivity({ actorId: user.id, entityType: "rating_form", entityId: row.id, action: fid ? "updated" : "created", metadata: { name: d.name } });
    done();
  });
}

export async function setFormRaters(formId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requirePeople();
    const fid = parseOrFail(uuid, formId);
    const d = parseOrFail(formRatersSchema, raw);
    await asUser(user, async (tx) => {
      await tx.ratingFormRater.deleteMany({ where: { formId: fid, subjectId: d.subjectId, raterId: { notIn: d.raterIds } } });
      await tx.ratingFormRater.createMany({ data: d.raterIds.filter((r) => r !== d.subjectId).map((raterId) => ({ formId: fid, subjectId: d.subjectId, raterId })), skipDuplicates: true });
    });
    await logActivity({ actorId: user.id, entityType: "rating_form", entityId: fid, action: "raters_set", metadata: d });
    done();
  });
}
