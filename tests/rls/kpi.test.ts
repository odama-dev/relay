/**
 * RLS suite for Phase 2 · M7: KPI definitions and templates, work logs,
 * ratings, manual entries, results and objections, and OKRs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = {
  boss: randomUUID(), // c_level + admin: every module
  hr: randomUUID(), // People module
  ad: randomUUID(), // manages dev
  dev: randomUUID(),
  dev2: randomUUID(),
  pm: randomUUID(),
};

const as = <T>(user: keyof typeof ids, fn: (tx: Tx) => Promise<T>) => withRls(ids[user], fn);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function denied(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the database to refuse this");
}

let metricId: string;
let projectId: string;

beforeAll(async () => {
  const people: [keyof typeof ids, UserRole, boolean?][] = [
    ["boss", "c_level", true],
    ["hr", "hr"],
    ["ad", "designer_dev"],
    ["dev", "designer_dev"],
    ["dev2", "designer_dev"],
    ["pm", "pm"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@kpi.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
  await prisma.profile.update({ where: { id: ids.dev }, data: { managerId: ids.ad } });
  const p = await prisma.project.create({ data: { name: "Brand", kind: "internal", pmId: ids.pm, startDate: day("2026-09-01"), createdBy: ids.pm } });
  projectId = p.id;
  await prisma.projectMember.create({ data: { projectId, userId: ids.dev } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Definitions", () => {
  it("lets the People module write metrics; everyone reads", async () => {
    const m = await as("hr", (tx) =>
      tx.metric.create({ data: { key: "shots", name: "Shots", direction: "higher", definition: { source: "shot", filters: {}, aggregation: "count" } } }),
    );
    metricId = m.id;
    await denied(as("dev", (tx) => tx.metric.create({ data: { key: "nope", name: "Nope", direction: "higher", definition: {} } })));
    expect(await as("dev", (tx) => tx.metric.count())).toBe(1);
  });

  it("locks an active template version and archives the one it replaces", async () => {
    const lineageId = randomUUID();
    const v1 = await as("hr", (tx) => tx.kpiTemplate.create({ data: { lineageId, version: 1, name: "Core", status: "active" } }));
    expect(v1.status).toBe("draft");
    await as("hr", (tx) => tx.kpiItem.create({ data: { templateId: v1.id, metricId, target: 10 } }));
    const active = await as("hr", (tx) => tx.kpiTemplate.update({ where: { id: v1.id }, data: { status: "active" } }));
    expect(active.effectiveFrom).not.toBeNull();
    expect(await denied(as("hr", (tx) => tx.kpiItem.create({ data: { templateId: v1.id, metricId, target: 5 } })))).toMatch(/locked/);
    expect(await denied(as("hr", (tx) => tx.kpiTemplate.update({ where: { id: v1.id }, data: { name: "Renamed" } })))).toMatch(/locked/);
    const v2 = await as("hr", (tx) => tx.kpiTemplate.create({ data: { lineageId, version: 2, name: "Core" } }));
    await as("hr", (tx) => tx.kpiItem.create({ data: { templateId: v2.id, metricId, target: 12 } }));
    await as("hr", (tx) => tx.kpiTemplate.update({ where: { id: v2.id }, data: { status: "active" } }));
    expect((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("archived");
    await denied(as("dev", (tx) => tx.kpiTemplate.create({ data: { lineageId: randomUUID(), version: 1, name: "Mine" } })));
  });
});

describe("Work logs", () => {
  let logId: string;

  it("starts as submitted and is reviewed by the manager, never by the person", async () => {
    const l = await as("dev", (tx) => tx.workLog.create({ data: { kind: "shot", userId: ids.dev, occurredOn: day("2026-10-20"), title: "Hero", status: "approved" } }));
    logId = l.id;
    expect(l.status).toBe("submitted");
    expect(await denied(as("dev", (tx) => tx.workLog.update({ where: { id: logId }, data: { status: "approved" } })))).toMatch(/review/);
    const ok = await as("ad", (tx) => tx.workLog.update({ where: { id: logId }, data: { status: "approved" } }));
    expect(ok.reviewedBy).toBe(ids.ad);
  });

  it("hides a person's log from peers but shows it to managers and People", async () => {
    expect(await as("dev2", (tx) => tx.workLog.count())).toBe(0);
    expect(await as("ad", (tx) => tx.workLog.count())).toBe(1);
    expect(await as("hr", (tx) => tx.workLog.count())).toBe(1);
  });

  it("lets the project's PM log and review errors about a member", async () => {
    const e = await as("pm", (tx) => tx.workLog.create({ data: { kind: "error", userId: ids.dev, projectId, occurredOn: day("2026-10-21"), title: "Typo live", link: "https://x.test/e" } }));
    await as("pm", (tx) => tx.workLog.update({ where: { id: e.id }, data: { status: "approved" } }));
    await denied(as("dev2", (tx) => tx.workLog.create({ data: { kind: "error", userId: ids.dev, occurredOn: day("2026-10-21"), title: "Nope" } })));
  });

  it("sets an idea's 3-working-day answer date", async () => {
    const i = await as("dev", (tx) => tx.workLog.create({ data: { kind: "idea", userId: ids.dev, occurredOn: day("2026-10-20"), title: "Idea", tags: ["skill_contribution"] } }));
    expect(i.responseDue).not.toBeNull();
  });
});

describe("Ratings and manual entries", () => {
  let selfForm: string;
  let criterion: string;

  beforeAll(async () => {
    const m = await prisma.metric.create({ data: { key: "collab", name: "Collab", direction: "higher", definition: { source: "rating", filters: {}, aggregation: "rating" } } });
    const f = await prisma.ratingForm.create({
      data: { metricId: m.id, name: "Self", frequency: "monthly", raterKind: "self", needsApproval: true, criteria: { create: [{ title: "Q", scale: ["1", "2", "3", "4", "5"] }] } },
      include: { criteria: true },
    });
    selfForm = f.id;
    criterion = f.criteria[0]!.id;
  });

  it("lets only the person self-assess, with a comment under 3, and HR approve", async () => {
    await denied(as("dev2", (tx) => tx.ratingResponse.create({ data: { formId: selfForm, subjectId: ids.dev, raterId: ids.dev2, periodStart: day("2026-10-01"), scores: { [criterion]: 4 }, average: 0 } })));
    expect(await denied(as("dev", (tx) => tx.ratingResponse.create({ data: { formId: selfForm, subjectId: ids.dev, raterId: ids.dev, periodStart: day("2026-10-01"), scores: { [criterion]: 2 }, average: 0 } })))).toMatch(/comment/);
    const r = await as("dev", (tx) => tx.ratingResponse.create({ data: { formId: selfForm, subjectId: ids.dev, raterId: ids.dev, periodStart: day("2026-10-01"), scores: { [criterion]: 4 }, average: 0 } }));
    expect(Number(r.average)).toBe(4);
    await denied(as("dev", (tx) => tx.ratingResponse.update({ where: { id: r.id }, data: { approvedBy: ids.dev } })));
    const ok = await as("hr", (tx) => tx.ratingResponse.update({ where: { id: r.id }, data: { approvedBy: ids.hr } }));
    expect(ok.approvedAt).not.toBeNull();
  });

  it("requires evidence on a manual entry", async () => {
    await denied(as("dev", (tx) => tx.manualEntry.create({ data: { metricId, userId: ids.dev, occurredOn: day("2026-10-02"), value: 3 } })));
    await as("dev", (tx) => tx.manualEntry.create({ data: { metricId, userId: ids.dev, occurredOn: day("2026-10-02"), value: 3, evidenceUrl: "https://x.test/proof" } }));
    expect(await as("dev2", (tx) => tx.manualEntry.count())).toBe(0);
  });
});

describe("Results and objections", () => {
  let resultId: string;

  beforeAll(async () => {
    const r = await prisma.kpiResult.create({ data: { userId: ids.dev, periodKind: "monthly", periodStart: day("2026-10-01"), periodEnd: day("2026-10-31"), items: [], score: 72, grade: "B" } });
    resultId = r.id;
  });

  it("shows a result to the person, their manager and People — and is never written through the API", async () => {
    expect(await as("dev", (tx) => tx.kpiResult.count())).toBe(1);
    expect(await as("ad", (tx) => tx.kpiResult.count())).toBe(1);
    expect(await as("hr", (tx) => tx.kpiResult.count())).toBe(1);
    expect(await as("dev2", (tx) => tx.kpiResult.count())).toBe(0);
    await denied(as("hr", (tx) => tx.kpiResult.update({ where: { id: resultId }, data: { score: 99 } })));
  });

  it("takes an objection from the person only, decided by People", async () => {
    await denied(as("dev2", (tx) => tx.kpiObjection.create({ data: { resultId, reason: "Not mine", createdBy: ids.dev2 } })));
    const o = await as("dev", (tx) => tx.kpiObjection.create({ data: { resultId, reason: "A shot is missing", createdBy: ids.dev } }));
    expect(await as("ad", (tx) => tx.kpiObjection.updateMany({ where: { id: o.id }, data: { status: "upheld" } }))).toEqual({ count: 0 });
    const d = await as("hr", (tx) => tx.kpiObjection.update({ where: { id: o.id }, data: { status: "upheld", decisionNote: "Fixed" } }));
    expect(d.decidedBy).toBe(ids.hr);
  });

  it("closes objections 7 days after the result", async () => {
    const old = await prisma.kpiResult.create({ data: { userId: ids.dev, periodKind: "monthly", periodStart: day("2026-08-01"), periodEnd: day("2026-08-31"), items: [], computedAt: new Date("2026-09-01T00:00:00Z") } });
    expect(await denied(as("dev", (tx) => tx.kpiObjection.create({ data: { resultId: old.id, reason: "Late", createdBy: ids.dev } })))).toMatch(/7 days/);
  });
});

describe("OKR", () => {
  let cycleId: string;
  let objectiveId: string;

  beforeAll(async () => {
    cycleId = (await prisma.okrCycle.create({ data: { name: "Q4 test", startDate: day("2026-10-01"), endDate: day("2026-12-31"), status: "active" } })).id;
  });

  it("lets a member propose; only People approves; studio objectives need Studio Report", async () => {
    const o = await as("dev", (tx) => tx.objective.create({ data: { cycleId, title: "Ship the library", status: "approved" } }));
    objectiveId = o.id;
    expect(o.status).toBe("proposed");
    await as("dev", (tx) => tx.objectiveOwner.create({ data: { objectiveId, userId: ids.dev } }));
    await denied(as("dev", (tx) => tx.objective.update({ where: { id: objectiveId }, data: { status: "approved" } })));
    const ok = await as("hr", (tx) => tx.objective.update({ where: { id: objectiveId }, data: { status: "approved" } }));
    expect(ok.approvedBy).toBe(ids.hr);
    await denied(as("dev", (tx) => tx.objective.create({ data: { cycleId, title: "Studio", isStudio: true } })));
    const s = await as("boss", (tx) => tx.objective.create({ data: { cycleId, title: "Grow 20%", isStudio: true } }));
    expect(s.status).toBe("approved");
  });

  it("lets owners check in and mark a milestone done; only the approver confirms", async () => {
    const kr = await as("hr", (tx) => tx.keyResult.create({ data: { objectiveId, title: "Launch", kind: "milestone", doneDefinition: "Live", approverId: ids.ad } }));
    await as("dev", (tx) => tx.krCheckin.create({ data: { keyResultId: kr.id, month: day("2026-10-01"), note: "On track" } }));
    await denied(as("dev2", (tx) => tx.krCheckin.create({ data: { keyResultId: kr.id, month: day("2026-11-01"), note: "Me too" } })));
    await as("dev", (tx) => tx.keyResult.update({ where: { id: kr.id }, data: { doneAt: new Date() } }));
    await denied(as("dev", (tx) => tx.keyResult.update({ where: { id: kr.id }, data: { doneApprovedBy: ids.dev } })));
    await denied(as("dev", (tx) => tx.keyResult.update({ where: { id: kr.id }, data: { targetValue: 5 } })));
    const c = await as("ad", (tx) => tx.keyResult.update({ where: { id: kr.id }, data: { doneApprovedBy: ids.ad } }));
    expect(c.doneApprovedBy).toBe(ids.ad);
  });
});

describe("Database setup", () => {
  it("enables RLS on every M7 table and grants nothing to anon", async () => {
    const tables = [
      "work_logs", "metrics", "rating_forms", "rating_criteria", "rating_form_raters", "rating_responses", "manual_entries", "kpi_templates", "kpi_items",
      "kpi_assignments", "kpi_results", "kpi_objections", "okr_cycles", "objectives", "objective_owners", "key_results", "kr_links", "kr_checkins",
    ];
    const rows = await prisma.$queryRaw<{ relname: string; rls: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tables}::text[])`;
    expect(rows).toHaveLength(tables.length);
    expect(rows.every((r) => r.rls)).toBe(true);
    const anon = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name = ANY(${tables}::text[])`;
    expect(Number(anon[0]!.n)).toBe(0);
  });
});
