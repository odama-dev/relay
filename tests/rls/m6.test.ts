/**
 * RLS suite for Phase 2 · M6: modules, the reporting line, job roles, task
 * review rounds, due date changes, holidays and attendance.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = {
  boss: randomUUID(), // c_level + admin
  hr: randomUUID(),
  pm: randomUUID(),
  ad: randomUUID(), // art director: reviewer, not on the project
  dev: randomUUID(),
  dev2: randomUUID(),
  fin: randomUUID(),
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

let projectId: string;
let sectionId: string;

beforeAll(async () => {
  const people: [keyof typeof ids, UserRole, boolean?][] = [
    ["boss", "c_level", true],
    ["hr", "hr"],
    ["pm", "pm"],
    ["ad", "designer_dev"],
    ["dev", "designer_dev"],
    ["dev2", "designer_dev"],
    ["fin", "finance"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@m6.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
  const p = await as("pm", (tx) => tx.project.create({ data: { name: "Brand", kind: "internal", pmId: ids.pm, startDate: day("2026-09-01"), createdBy: ids.pm } }));
  projectId = p.id;
  await as("pm", (tx) => tx.projectMember.create({ data: { projectId, userId: ids.dev, addedBy: ids.pm } }));
  sectionId = (await prisma.section.findFirstOrThrow({ where: { projectId } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Access presets and modules", () => {
  it("gives a new profile the division, access and modules of its role", async () => {
    const hr = await prisma.profile.findUniqueOrThrow({ where: { id: ids.hr }, include: { modules: true } });
    expect(hr.division).toBe("people");
    expect(hr.modules.map((m) => m.module)).toEqual(["people"]);
    const pm = await prisma.profile.findUniqueOrThrow({ where: { id: ids.pm } });
    expect(pm.accessLevel).toBe("manager");
    const boss = await prisma.moduleGrant.count({ where: { userId: ids.boss } });
    expect(boss).toBe(4);
  });

  it("lets only an admin grant modules or change access", async () => {
    await denied(as("hr", (tx) => tx.moduleGrant.create({ data: { userId: ids.dev, module: "sales" } })));
    await as("boss", (tx) => tx.moduleGrant.create({ data: { userId: ids.dev2, module: "studio_report" } }));
    expect(await prisma.moduleGrant.findUniqueOrThrow({ where: { userId_module: { userId: ids.dev2, module: "studio_report" } } })).toMatchObject({ grantedBy: ids.boss });
    expect(await denied(as("hr", (tx) => tx.profile.update({ where: { id: ids.dev }, data: { accessLevel: "manager" } })))).toMatch(/Only an admin/);
  });

  it("lets the People module set the manager, level and title — not the person", async () => {
    await as("hr", (tx) => tx.profile.update({ where: { id: ids.dev }, data: { managerId: ids.ad, level: 2, jobTitle: "Senior Staff Designer" } }));
    await as("hr", (tx) => tx.profile.update({ where: { id: ids.ad }, data: { managerId: ids.pm } }));
    expect(await denied(as("dev", (tx) => tx.profile.update({ where: { id: ids.dev }, data: { level: 5 } })))).toMatch(/People module/);
    expect(await denied(as("hr", (tx) => tx.profile.update({ where: { id: ids.pm }, data: { managerId: ids.dev } })))).toMatch(/already reports/);
  });

  it("knows the reporting line, up more than one level", async () => {
    const check = (who: keyof typeof ids, of: keyof typeof ids) =>
      as(who, (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app.is_manager_of(${ids[of]}::uuid) AS ok`).then((r) => r[0]!.ok);
    expect(await check("ad", "dev")).toBe(true);
    expect(await check("pm", "dev")).toBe(true);
    expect(await check("dev", "ad")).toBe(false);
    expect(await check("dev2", "dev")).toBe(false);
  });

  it("lets the People module manage job roles and task types; others read", async () => {
    await as("hr", (tx) => tx.jobRole.create({ data: { name: "Motion Designer", division: "design", level: 3 } }));
    await denied(as("pm", (tx) => tx.jobRole.create({ data: { name: "Nope", division: "design", level: 1 } })));
    expect(await as("dev", (tx) => tx.jobRole.count())).toBe(1);
    expect(await as("dev", (tx) => tx.taskType.count())).toBe(5);
    await denied(as("dev", (tx) => tx.taskType.create({ data: { name: "Shot", key: "shot" } })));
  });
});

describe("Task review flow", () => {
  let taskId: string;

  it("keeps the first due date and opens a review round with a one-working-day SLA", async () => {
    const t = await as("dev", (tx) =>
      tx.task.create({ data: { projectId, sectionId, title: "Hero", ownerId: ids.dev, reviewerId: ids.ad, dueDate: day("2026-10-23"), estimateHours: 2, createdBy: ids.dev } }),
    );
    taskId = t.id;
    expect(t.originalDueDate).toEqual(day("2026-10-23"));
    await as("dev", (tx) => tx.task.update({ where: { id: taskId }, data: { status: "in_progress" } }));
    await as("dev", (tx) => tx.task.update({ where: { id: taskId }, data: { status: "review" } }));
    const round = await prisma.reviewRound.findFirstOrThrow({ where: { taskId } });
    expect(round.reviewerId).toBe(ids.ad);
    expect(round.slaDueAt.getTime()).toBeGreaterThan(round.submittedAt.getTime());
  });

  it("refuses the owner approving their own work", async () => {
    expect(await denied(as("dev", (tx) => tx.task.update({ where: { id: taskId }, data: { status: "done" } })))).toMatch(/reviewer/);
  });

  it("lets the reviewer — off the project — see and send it back, then approve", async () => {
    expect(await as("ad", (tx) => tx.task.count({ where: { id: taskId } }))).toBe(1);
    expect(await as("dev2", (tx) => tx.task.count({ where: { id: taskId } }))).toBe(0);
    await as("ad", (tx) => tx.task.update({ where: { id: taskId }, data: { status: "in_progress" } }));
    await as("dev", (tx) => tx.task.update({ where: { id: taskId }, data: { status: "review" } }));
    const approved = await as("ad", (tx) => tx.task.update({ where: { id: taskId }, data: { status: "done" } }));
    expect(approved.approvedAt).not.toBeNull();
    const rounds = await prisma.reviewRound.findMany({ where: { taskId }, orderBy: { submittedAt: "asc" } });
    expect(rounds.map((r) => r.decision)).toEqual(["changes_requested", "approved"]);
    expect(await as("dev", (tx) => tx.reviewRound.count({ where: { taskId } }))).toBe(2);
  });

  it("needs an approved change with a reason to move a due date", async () => {
    const t = await as("dev", (tx) =>
      tx.task.create({ data: { projectId, sectionId, title: "Icons", ownerId: ids.dev, dueDate: day("2026-10-26"), createdBy: ids.dev } }),
    );
    expect(await denied(as("dev", (tx) => tx.task.update({ where: { id: t.id }, data: { dueDate: day("2026-10-30") } })))).toMatch(/reason/);
    // The owner asks; it stays pending.
    const ask = await as("dev", (tx) => tx.dueDateChange.create({ data: { taskId: t.id, toDate: day("2026-10-30"), reason: "Client late" } }));
    expect(ask.approvedAt).toBeNull();
    expect(ask.fromDate).toEqual(day("2026-10-26"));
    await denied(as("dev", (tx) => tx.dueDateChange.update({ where: { id: ask.id }, data: { approvedAt: new Date() } })));
    // The PM approves and moves the date in the same transaction.
    await as("pm", async (tx) => {
      await tx.dueDateChange.update({ where: { id: ask.id }, data: { approvedBy: ids.pm } });
      await tx.task.update({ where: { id: t.id }, data: { dueDate: day("2026-10-30") } });
    });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.dueDate).toEqual(day("2026-10-30"));
    expect(after.originalDueDate).toEqual(day("2026-10-26"));
  });
});

describe("Holidays and attendance", () => {
  it("lets the People module keep holidays; everyone reads", async () => {
    await as("hr", (tx) => tx.publicHoliday.create({ data: { date: day("2026-12-25"), name: "Christmas" } }));
    await denied(as("pm", (tx) => tx.publicHoliday.create({ data: { date: day("2026-12-26"), name: "Nope" } })));
    expect(await as("dev", (tx) => tx.publicHoliday.count())).toBe(1);
  });

  it("lets people check themselves in; managers and People read it", async () => {
    await as("dev", (tx) => tx.attendance.create({ data: { userId: ids.dev, date: day("2026-10-22"), status: "present" } }));
    await denied(as("dev", (tx) => tx.attendance.create({ data: { userId: ids.dev2, date: day("2026-10-22"), status: "present" } })));
    expect(await as("ad", (tx) => tx.attendance.count())).toBe(1);
    expect(await as("hr", (tx) => tx.attendance.count())).toBe(1);
    // dev2 holds Studio Report (granted above); Finance holds neither.
    expect(await as("dev2", (tx) => tx.attendance.count())).toBe(1);
    expect(await as("fin", (tx) => tx.attendance.count())).toBe(0);
  });

  it("enables RLS on every new table and grants nothing to anon", async () => {
    const rows = await prisma.$queryRaw<{ relname: string; rls: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('job_roles','module_grants','task_types','review_rounds','due_date_changes','public_holidays','attendance')`;
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.rls)).toBe(true);
    const anon = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants
      WHERE grantee = 'anon' AND table_name IN ('job_roles','module_grants','task_types','review_rounds','due_date_changes','public_holidays','attendance')`;
    expect(Number(anon[0]!.n)).toBe(0);
  });
});
