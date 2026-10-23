/**
 * KPI library seed (PRD Phase 2 "Import KPI Master"): metrics, rating forms,
 * KPI templates, job roles with their templates, and the Q4 2026 OKR cycle,
 * from prisma/data/kpi-master.json (exported from the KPI Master sheet).
 * Safe to run again — existing rows are kept, HR's edits are never overwritten.
 *
 *   pnpm db:seed:kpi
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type AccessLevel, type AppModule, type Division, type KpiItemKind, type RaterKind, type RatingFrequency, type ScorePeriod, type UserRole } from "@prisma/client";
import { metricDefinitionSchema } from "../lib/kpi/definition";

type Data = {
  metrics: { key: string; name: string; direction: string; unit: string; definition: unknown; description: string; manual: boolean }[];
  templates: { name: string; kind: KpiItemKind; items: { metric: string; target: number | null; targetPer: string; scorePeriod: ScorePeriod; weight: number; recordOnly: boolean; tag: string | null }[] }[];
  jobRoles: { name: string; division: Division; level: number; defaultAccess: AccessLevel; defaultModules: AppModule[]; hasOkr: boolean; templates: string[] }[];
  ratingForms: { metric: string; name: string; frequency: RatingFrequency; raterKind: RaterKind; raterJobRole?: string; needsApproval: boolean; criteria: { title: string; scale: string[] }[] }[];
  okrCycles: { name: string; startDate: string; endDate: string; status: "draft" | "active" | "closed" }[];
};

const day = (s: string) => new Date(`${s}T00:00:00Z`);
/** When the library starts counting — the first month of calibration. */
const STARTS = "2026-10-01";

/** Seeded people without a job role get the one matching their Phase 1 role. */
const ROLE_JOB: Record<UserRole, string> = {
  designer_dev: "Senior Staff Designer",
  pm: "Project Manager",
  sales: "Account Lead",
  hr: "HR",
  finance: "Finance",
  c_level: "Founder / Executive",
};

export async function seedKpi(prisma: PrismaClient) {
  const data = JSON.parse(readFileSync(join(__dirname, "data", "kpi-master.json"), "utf8")) as Data;

  const metricId = new Map<string, string>();
  for (const m of data.metrics) {
    const definition = metricDefinitionSchema.parse(m.definition);
    const row = await prisma.metric.upsert({
      where: { key: m.key },
      create: { key: m.key, name: m.name, direction: m.direction, unit: m.unit, definition, description: m.description, manual: m.manual, status: "active" },
      update: {},
    });
    metricId.set(m.key, row.id);
  }

  const jobRoleId = new Map<string, string>();
  for (const r of data.jobRoles) {
    const row = await prisma.jobRole.upsert({
      where: { name: r.name },
      create: { name: r.name, division: r.division, level: r.level, defaultAccess: r.defaultAccess, defaultModules: r.defaultModules, hasOkr: r.hasOkr },
      update: {},
    });
    jobRoleId.set(r.name, row.id);
  }

  for (const f of data.ratingForms) {
    if (await prisma.ratingForm.findFirst({ where: { name: f.name } })) continue;
    await prisma.ratingForm.create({
      data: {
        metricId: metricId.get(f.metric)!,
        name: f.name,
        frequency: f.frequency,
        raterKind: f.raterKind,
        raterJobRoleId: f.raterJobRole ? (jobRoleId.get(f.raterJobRole) ?? null) : null,
        needsApproval: f.needsApproval,
        criteria: { create: f.criteria.map((c, i) => ({ title: c.title, scale: c.scale, position: i })) },
      },
    });
  }

  const lineage = new Map<string, { id: string; kind: KpiItemKind }>();
  for (const t of data.templates) {
    const existing = await prisma.kpiTemplate.findFirst({ where: { name: t.name }, orderBy: { version: "asc" } });
    if (existing) {
      lineage.set(t.name, { id: existing.lineageId, kind: existing.kind });
      continue;
    }
    const lineageId = randomUUID();
    await prisma.kpiTemplate.create({
      data: {
        lineageId,
        version: 1,
        name: t.name,
        kind: t.kind,
        status: "active",
        effectiveFrom: day(STARTS),
        activatedAt: new Date(),
        items: {
          create: t.items.map((it, i) => ({
            metricId: metricId.get(it.metric)!,
            target: it.target,
            targetPer: it.targetPer,
            scorePeriod: it.scorePeriod,
            weight: it.weight,
            recordOnly: it.recordOnly,
            tag: it.tag,
            position: i,
          })),
        },
      },
    });
    lineage.set(t.name, { id: lineageId, kind: t.kind });
  }

  for (const r of data.jobRoles) {
    for (const name of r.templates) {
      const l = lineage.get(name);
      if (!l) continue;
      const jr = jobRoleId.get(r.name)!;
      if (await prisma.kpiAssignment.findFirst({ where: { jobRoleId: jr, lineageId: l.id } })) continue;
      await prisma.kpiAssignment.create({ data: { lineageId: l.id, kind: l.kind, jobRoleId: jr, startsOn: day(STARTS) } });
    }
  }

  for (const c of data.okrCycles) {
    await prisma.okrCycle.upsert({ where: { name: c.name }, create: { name: c.name, startDate: day(c.startDate), endDate: day(c.endDate), status: c.status }, update: {} });
  }

  const people = await prisma.profile.findMany({ where: { jobRoleId: null }, select: { id: true, role: true } });
  for (const p of people) {
    const jr = jobRoleId.get(ROLE_JOB[p.role]);
    if (jr) await prisma.profile.update({ where: { id: p.id }, data: { jobRoleId: jr } });
  }

  console.log(`KPI library: ${data.metrics.length} metrics, ${data.templates.length} templates, ${data.jobRoles.length} job roles, ${data.ratingForms.length} rating forms.`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedKpi(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
