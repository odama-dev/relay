/**
 * RLS suite (PRD "Tips build": an RLS test for every table). Each test acts
 * as a real role through `withRls` — the same path the app and the Supabase
 * API take — against a freshly migrated database (`pnpm test:rls`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = {
  boss: randomUUID(), // c_level + admin
  pm: randomUUID(),
  pm2: randomUUID(), // a PM not on the project
  dev: randomUUID(), // member of project A
  dev2: randomUUID(), // member of nothing
  sales: randomUUID(),
  finance: randomUUID(),
  hr: randomUUID(),
  gone: randomUUID(), // deactivated
};

let clientId: string;
let projectA: string; // client project, dev is a member
let projectB: string; // client project, dev isn't
let internal: string;
let sectionA: string;
let taskA: string;
let categoryId: string;

const as = <T>(user: keyof typeof ids, fn: (tx: Tx) => Promise<T>) => withRls(ids[user], fn);

async function denied(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the database to refuse this");
}

beforeAll(async () => {
  const people: [keyof typeof ids, UserRole, boolean?][] = [
    ["boss", "c_level", true],
    ["pm", "pm"],
    ["pm2", "pm"],
    ["dev", "designer_dev"],
    ["dev2", "designer_dev"],
    ["sales", "sales"],
    ["finance", "finance"],
    ["hr", "hr"],
    ["gone", "designer_dev"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({
      data: {
        id: ids[key],
        email: `${key}@rls.test`,
        fullName: key,
        role,
        isAdmin: Boolean(isAdmin),
        status: key === "gone" ? "deactivated" : "active",
      },
    });
  }

  // Sales creates the client and both client projects through RLS (M1.1, M1.2).
  const created = await as("sales", async (tx) => {
    const client = await tx.client.create({ data: { code: "ACME", name: "Acme Corp", createdBy: ids.sales } });
    const a = await tx.project.create({
      data: {
        name: "Website",
        kind: "client",
        clientId: client.id,
        contractType: "fixed",
        currency: "USD",
        pmId: ids.pm,
        startDate: new Date("2026-09-01"),
        createdBy: ids.sales,
      },
    });
    const b = await tx.project.create({
      data: {
        name: "App",
        kind: "client",
        clientId: client.id,
        contractType: "retainer",
        currency: "USD",
        pmId: ids.pm,
        startDate: new Date("2026-09-01"),
        createdBy: ids.sales,
      },
    });
    await tx.projectContract.create({ data: { projectId: a.id, contractValue: 12000 } });
    await tx.projectBudget.create({ data: { projectId: a.id, budgetHours: 100 } });
    return { client, a, b };
  });
  clientId = created.client.id;
  projectA = created.a.id;
  projectB = created.b.id;

  const int = await as("pm", (tx) =>
    tx.project.create({
      data: { name: "R&D", kind: "internal", pmId: ids.pm, startDate: new Date("2026-09-01"), createdBy: ids.pm },
    }),
  );
  internal = int.id;

  await as("pm", (tx) => tx.projectMember.create({ data: { projectId: projectA, userId: ids.dev, addedBy: ids.pm } }));
  sectionA = (await prisma.section.findFirstOrThrow({ where: { projectId: projectA } })).id;
  categoryId = (await prisma.workCategory.findFirstOrThrow({ where: { name: "Riset" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("database setup", () => {
  it("has RLS enabled on every public table", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("gives anon nothing", async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants
      WHERE grantee = 'anon' AND table_schema = 'public'`;
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("M1 — clients & projects", () => {
  it("numbers projects per client and internal projects as INT", async () => {
    const codes = await prisma.project.findMany({ orderBy: { createdAt: "asc" }, select: { code: true } });
    expect(codes.map((c) => c.code)).toEqual(["ACME-001", "ACME-002", "INT-001"]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: internal } })).clientId).toBeNull();
  });

  it("makes the PM a member and creates a General section", async () => {
    expect(await prisma.projectMember.count({ where: { projectId: projectA, userId: ids.pm } })).toBe(1);
    expect(await prisma.section.findMany({ where: { projectId: projectB }, select: { name: true } })).toEqual([{ name: "General" }]);
  });

  it("locks the client code once the client has projects", async () => {
    const msg = await denied(as("sales", (tx) => tx.client.update({ where: { id: clientId }, data: { code: "ACMX" } })));
    expect(msg).toMatch(/client code/);
  });

  it("shows Designer & Dev only the projects they are on", async () => {
    const seen = await as("dev", (tx) => tx.project.findMany({ select: { id: true } }));
    expect(seen.map((p) => p.id)).toEqual([projectA]);
    expect(await as("dev2", (tx) => tx.project.count())).toBe(0);
  });

  it("lets PM, Sales, Finance, HR and C-Level see every project", async () => {
    for (const who of ["pm2", "sales", "finance", "hr", "boss"] as const) {
      expect(await as(who, (tx) => tx.project.count())).toBe(3);
    }
  });

  it("hides the contract value from Designer & Dev, HR and PMs off the project", async () => {
    expect(await as("dev", (tx) => tx.projectContract.count())).toBe(0);
    expect(await as("hr", (tx) => tx.projectContract.count())).toBe(0);
    expect(await as("pm2", (tx) => tx.projectContract.count())).toBe(0);
    expect(await as("pm", (tx) => tx.projectContract.count())).toBe(1);
    expect(await as("finance", (tx) => tx.projectContract.count())).toBe(1);
  });

  it("hides budgets from HR", async () => {
    expect(await as("hr", (tx) => tx.projectBudget.count())).toBe(0);
    expect(await as("dev", (tx) => tx.projectBudget.count())).toBe(1);
  });

  it("hides clients from HR and Designer & Dev without a project there", async () => {
    expect(await as("hr", (tx) => tx.client.count())).toBe(0);
    expect(await as("dev2", (tx) => tx.client.count())).toBe(0);
    expect(await as("dev", (tx) => tx.client.count())).toBe(1);
  });

  it("refuses project edits from Designer & Dev and Finance", async () => {
    for (const who of ["dev", "finance"] as const) {
      const n = await as(who, (tx) => tx.project.updateMany({ where: { id: projectA }, data: { name: "Hacked" } }));
      expect(n.count).toBe(0);
    }
  });

  it("only lets the project's PM or C-Level manage members", async () => {
    await denied(as("pm2", (tx) => tx.projectMember.create({ data: { projectId: projectA, userId: ids.dev2 } })));
    await denied(as("sales", (tx) => tx.projectMember.create({ data: { projectId: projectA, userId: ids.dev2 } })));
  });

  it("lets the project's PM set its calendar colour; another PM or a designer can't", async () => {
    const set = (who: keyof typeof ids) => as(who, (tx) => tx.project.updateMany({ where: { id: projectA }, data: { calendarColor: "teal" } }));
    expect((await set("pm2")).count).toBe(0);
    expect((await set("dev")).count).toBe(0);
    expect((await set("pm")).count).toBe(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectA } })).calendarColor).toBe("teal");
  });

  it("refuses deactivated people as members", async () => {
    const msg = await denied(as("pm", (tx) => tx.projectMember.create({ data: { projectId: projectA, userId: ids.gone } })));
    expect(msg).toMatch(/active people/);
  });

  it("gives deactivated users no access at all", async () => {
    expect(await as("gone", (tx) => tx.profile.count())).toBe(0);
    expect(await as("gone", (tx) => tx.project.count())).toBe(0);
  });
});

describe("M0 — people", () => {
  it("doesn't let a user change their own role or admin flag", async () => {
    await denied(as("dev", (tx) => tx.profile.update({ where: { id: ids.dev }, data: { role: "c_level" } })));
    await denied(as("dev", (tx) => tx.profile.update({ where: { id: ids.dev }, data: { isAdmin: true } })));
    await as("dev", (tx) => tx.profile.update({ where: { id: ids.dev }, data: { fullName: "Dev One" } }));
  });

  it("lets HR change roles but not the admin flag", async () => {
    await as("hr", (tx) => tx.profile.update({ where: { id: ids.dev2 }, data: { employmentType: "freelancer" } }));
    await denied(as("hr", (tx) => tx.profile.update({ where: { id: ids.dev2 }, data: { isAdmin: true } })));
  });

  it("keeps settings admin-only", async () => {
    const n = await as("pm", (tx) => tx.appSetting.updateMany({ data: { value: "1" } }));
    expect(n.count).toBe(0);
  });
});

describe("M2 — tasks", () => {
  it("lets members create tasks, not outsiders, Sales or Finance", async () => {
    const task = await as("dev", (tx) =>
      tx.task.create({ data: { projectId: projectA, sectionId: sectionA, title: "Hero section", ownerId: ids.dev, createdBy: ids.dev } }),
    );
    taskA = task.id;
    await denied(
      as("dev2", (tx) => tx.task.create({ data: { projectId: projectA, sectionId: sectionA, title: "x", createdBy: ids.dev2 } })),
    );
    await denied(
      as("finance", (tx) => tx.task.create({ data: { projectId: projectA, sectionId: sectionA, title: "x", createdBy: ids.finance } })),
    );
  });

  it("hides tasks from non-members and Finance; HR reads every task but can't change one", async () => {
    for (const who of ["dev2", "finance", "pm2"] as const) {
      expect(await as(who, (tx) => tx.task.count())).toBe(0);
    }
    expect(await as("boss", (tx) => tx.task.count())).toBe(1);
    expect(await as("hr", (tx) => tx.task.count())).toBe(1);
    expect(await as("hr", (tx) => tx.task.updateMany({ data: { title: "HR edit" } }))).toEqual({ count: 0 });
  });

  it("only lets an active member own a task", async () => {
    const msg = await denied(as("pm", (tx) => tx.task.update({ where: { id: taskA }, data: { ownerId: ids.dev2 } })));
    expect(msg).toMatch(/active member/);
  });

  it("keeps a deleted comment's text but marks who deleted it", async () => {
    const c = await as("dev", (tx) => tx.taskComment.create({ data: { taskId: taskA, authorId: ids.dev, body: { text: "secret" } } }));
    const pmEdit = await as("pm", (tx) => tx.taskComment.updateMany({ where: { id: c.id }, data: { body: { text: "x" } } }));
    expect(pmEdit.count).toBe(0);
    await as("dev", (tx) => tx.taskComment.update({ where: { id: c.id }, data: { deletedAt: new Date(), body: { text: "" } } }));
    const row = await prisma.taskComment.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.body).toEqual({ text: "secret" });
    expect(row.deletedBy).toBe(ids.dev);
  });

  it("only lets the project's PM delete tasks", async () => {
    const n = await as("dev", (tx) => tx.task.deleteMany({ where: { id: taskA } }));
    expect(n.count).toBe(0);
  });
});

describe("M3 — time log", () => {
  let entryId: string;

  it("derives the project and billable flag from the task", async () => {
    const e = await as("dev", (tx) =>
      tx.timeEntry.create({ data: { userId: ids.dev, entryDate: new Date("2026-10-06"), minutes: 90, taskId: taskA } }),
    );
    entryId = e.id;
    expect(e.projectId).toBe(projectA);
    expect(e.isBillable).toBe(true);
    const cat = await as("dev", (tx) =>
      tx.timeEntry.create({ data: { userId: ids.dev, entryDate: new Date("2026-10-06"), minutes: 30, categoryId } }),
    );
    expect(cat.isBillable).toBe(false);
    expect(cat.projectId).toBeNull();
  });

  it("refuses logging for someone else or to a project you're not on", async () => {
    await denied(as("dev", (tx) => tx.timeEntry.create({ data: { userId: ids.dev2, entryDate: new Date("2026-10-06"), minutes: 30, categoryId } })));
    const msg = await denied(
      as("dev2", (tx) => tx.timeEntry.create({ data: { userId: ids.dev2, entryDate: new Date("2026-10-06"), minutes: 30, taskId: taskA } })),
    );
    expect(msg).toMatch(/not a member/);
  });

  it("requires a note for out-of-scope work", async () => {
    const msg = await denied(
      as("dev", (tx) =>
        tx.timeEntry.create({ data: { userId: ids.dev, entryDate: new Date("2026-10-07"), minutes: 60, taskId: taskA, oosStatus: "pending" } }),
      ),
    );
    expect(msg).toMatch(/note/);
  });

  it("lets only the project's PM approve out-of-scope work", async () => {
    const e = await as("dev", (tx) =>
      tx.timeEntry.create({
        data: { userId: ids.dev, entryDate: new Date("2026-10-07"), minutes: 60, taskId: taskA, oosStatus: "pending", note: "Extra page" },
      }),
    );
    await denied(as("dev", (tx) => tx.timeEntry.update({ where: { id: e.id }, data: { oosStatus: "approved" } })));
    const n = await as("pm2", (tx) => tx.timeEntry.updateMany({ where: { id: e.id }, data: { oosStatus: "approved" } }));
    expect(n.count).toBe(0);
    const ok = await as("pm", (tx) => tx.timeEntry.update({ where: { id: e.id }, data: { oosStatus: "approved" } }));
    expect(ok.oosReviewedBy).toBe(ids.pm);
    await denied(as("pm", (tx) => tx.timeEntry.update({ where: { id: e.id }, data: { minutes: 1 } })));
  });

  it("shows PMs their projects' time, HR everything, others their own", async () => {
    expect(await as("pm", (tx) => tx.timeEntry.count())).toBe(2); // project entries only
    expect(await as("hr", (tx) => tx.timeEntry.count())).toBe(3);
    expect(await as("sales", (tx) => tx.timeEntry.count())).toBe(0);
    expect(await as("pm2", (tx) => tx.timeEntry.count())).toBe(0);
  });

  it("freezes a locked week; changes go through a correction", async () => {
    await prisma.timesheetLock.create({ data: { weekStart: new Date("2026-10-05") } });
    const msg = await denied(as("dev", (tx) => tx.timeEntry.update({ where: { id: entryId }, data: { minutes: 120 } })));
    expect(msg).toMatch(/locked/);
    await denied(as("dev", (tx) => tx.timeEntry.delete({ where: { id: entryId } })));

    const corr = await as("dev", (tx) =>
      tx.timeCorrection.create({
        data: { timeEntryId: entryId, requestedBy: ids.dev, proposed: { minutes: 120 }, reason: "Forgot the review call" },
      }),
    );
    expect(corr.projectId).toBe(projectA);
    // HR reviews only category corrections; the project's PM reviews this one.
    expect((await as("hr", (tx) => tx.timeCorrection.updateMany({ where: { id: corr.id }, data: { status: "approved" } }))).count).toBe(0);
    const reviewed = await as("pm", (tx) => tx.timeCorrection.update({ where: { id: corr.id }, data: { status: "approved" } }));
    expect(reviewed.reviewedBy).toBe(ids.pm);
  });

  it("refuses time on completed projects", async () => {
    await prisma.project.update({ where: { id: projectA }, data: { status: "completed" } });
    const msg = await denied(
      as("dev", (tx) => tx.timeEntry.create({ data: { userId: ids.dev, entryDate: new Date("2026-10-13"), minutes: 30, taskId: taskA } })),
    );
    expect(msg).toMatch(/Active or On hold/);
    await prisma.project.update({ where: { id: projectA }, data: { status: "active" } });
  });

  it("won't delete a task that has logged time", async () => {
    await denied(as("pm", (tx) => tx.task.delete({ where: { id: taskA } })));
  });
});

describe("M5 — invoices", () => {
  let invoiceId: string;

  it("lets Sales and Finance draft invoices, nobody else", async () => {
    const inv = await as("sales", (tx) =>
      tx.invoice.create({
        data: { projectId: projectA, clientId, currency: "USD", issueDate: new Date("2026-10-13"), billToName: "Acme", total: 1000, createdBy: ids.sales },
      }),
    );
    invoiceId = inv.id;
    await denied(
      as("pm", (tx) =>
        tx.invoice.create({
          data: { projectId: projectA, clientId, currency: "USD", issueDate: new Date("2026-10-13"), billToName: "Acme", createdBy: ids.pm },
        }),
      ),
    );
  });

  it("shows invoices to Sales, Finance, C-Level and the project's PM only", async () => {
    expect(await as("dev", (tx) => tx.invoice.count())).toBe(0);
    expect(await as("hr", (tx) => tx.invoice.count())).toBe(0);
    expect(await as("pm2", (tx) => tx.invoice.count())).toBe(0);
    expect(await as("pm", (tx) => tx.invoice.count())).toBe(1);
    expect(await as("boss", (tx) => tx.invoice.count())).toBe(1);
    // PM reads but can't change.
    expect((await as("pm", (tx) => tx.invoice.updateMany({ data: { notes: "x" } }))).count).toBe(0);
  });

  it("can't be issued or paid through the API", async () => {
    await denied(as("sales", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { status: "sent" } })));
    await denied(as("finance", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: 1000 } })));
  });

  it("locks a sent invoice except for voiding", async () => {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "sent", number: "ODAMA/26/0001", sentAt: new Date() } });
    await denied(as("sales", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { total: 1 } })));
    await denied(as("sales", (tx) => tx.invoiceItem.create({ data: { invoiceId, description: "x", quantity: 1, unitPrice: 1, amount: 1 } })));
    const v = await as("finance", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { status: "void" } }));
    expect(v.voidedAt).not.toBeNull();
  });

  it("numbers invoices without gaps or duplicates, system-only", async () => {
    const run = () => prisma.$queryRaw<{ n: number }[]>`SELECT app.next_invoice_number(2099) AS n`;
    const results = await Promise.all([run(), run(), run(), run()]);
    expect(results.map((r) => r[0]!.n).sort()).toEqual([1, 2, 3, 4]);
    await denied(as("sales", (tx) => tx.$queryRaw`SELECT app.next_invoice_number(2099)`));
  });

  it("keeps payments away from Designer & Dev and HR", async () => {
    await prisma.payment.create({
      data: { externalId: "xnd_1", amount: 10, currency: "USD", paidAt: new Date(), raw: {} },
    });
    expect(await as("dev", (tx) => tx.payment.count())).toBe(0);
    expect(await as("hr", (tx) => tx.payment.count())).toBe(0);
    expect(await as("finance", (tx) => tx.payment.count())).toBe(1);
  });
});

describe("Expenses", () => {
  const data = (by: string) => ({
    expenseDate: new Date("2026-10-01"),
    vendor: "PLN",
    category: "utilities" as const,
    kind: "opex" as const,
    amount: 1_250_000,
    currency: "IDR",
    createdBy: by,
  });

  it("lets Finance and C-Level record expenses, nobody else", async () => {
    await as("finance", (tx) => tx.expense.create({ data: data(ids.finance) }));
    await as("boss", (tx) => tx.expense.create({ data: data(ids.boss) }));
    for (const role of ["pm", "dev", "sales", "hr"] as const) {
      expect(await denied(as(role, (tx) => tx.expense.create({ data: data(ids[role]) })))).toMatch(/row-level security/);
    }
    // Recording on someone else's behalf is refused too.
    expect(await denied(as("finance", (tx) => tx.expense.create({ data: data(ids.boss) })))).toMatch(/row-level security/);
  });

  it("hides expenses from everyone but Finance and C-Level", async () => {
    expect(await as("finance", (tx) => tx.expense.count())).toBeGreaterThanOrEqual(2);
    expect(await as("boss", (tx) => tx.expense.count())).toBeGreaterThanOrEqual(2);
    for (const role of ["pm", "dev", "sales", "hr"] as const) {
      expect(await as(role, (tx) => tx.expense.count())).toBe(0);
      expect((await as(role, (tx) => tx.expense.updateMany({ data: { vendor: "Hacked" } }))).count).toBe(0);
      expect((await as(role, (tx) => tx.expense.deleteMany())).count).toBe(0);
    }
  });

  it("checks amounts and keeps who recorded it", async () => {
    expect(await denied(as("finance", (tx) => tx.expense.create({ data: { ...data(ids.finance), amount: 0 } })))).toMatch(/expenses_amount_positive/);
    const e = await as("finance", (tx) => tx.expense.create({ data: data(ids.finance) }));
    expect(await denied(as("boss", (tx) => tx.expense.update({ where: { id: e.id }, data: { createdBy: ids.boss } })))).toMatch(/can't change/);
    await as("boss", (tx) => tx.expense.update({ where: { id: e.id }, data: { amount: 1_300_000 } }));
    await as("boss", (tx) => tx.expense.delete({ where: { id: e.id } }));
  });
});

describe("Dashboard (PRD/OVERVIEW-SPEC.md)", () => {
  const summary = (tx: Tx) =>
    tx.$queryRaw<{ user_id: string; open_tasks: number; overdue_tasks: number; done_this_month: number }[]>`
      SELECT user_id::text, open_tasks, overdue_tasks, done_this_month
      FROM app.task_summary_per_person('2026-10-16'::date, '2026-10-01'::date, '2026-10-31'::date)`;

  it("gives HR and C-Level task counts per person", async () => {
    await prisma.task.create({
      data: { projectId: projectA, sectionId: sectionA, title: "Late hero", ownerId: ids.dev, dueDate: new Date("2026-10-01"), createdBy: ids.pm },
    });
    const hr = await as("hr", summary);
    const dev = hr.find((r) => r.user_id === ids.dev);
    expect(dev?.overdue_tasks).toBeGreaterThanOrEqual(1);
    expect(dev?.open_tasks).toBeGreaterThanOrEqual(dev!.overdue_tasks);
    expect(hr.some((r) => r.user_id === ids.gone)).toBe(false); // active people only
    expect((await as("boss", summary)).length).toBe(hr.length);
  });

  it("returns nothing to the other roles", async () => {
    for (const role of ["dev", "pm", "sales", "finance"] as const) {
      expect(await as(role, summary)).toEqual([]);
    }
  });
});

describe("C-Level dashboard inputs (PRD/Clevel dashboard.md §2.1, §7)", () => {
  const from = new Date("2026-01-01");

  it("keeps people costs to HR and C-Level — Finance included in nobody else", async () => {
    await as("hr", (tx) => tx.personCost.create({ data: { userId: ids.dev, effectiveFrom: from, monthlyCostIdr: 15_000_000, createdBy: ids.hr } }));
    await as("boss", (tx) => tx.personCost.create({ data: { userId: ids.pm, effectiveFrom: from, monthlyCostIdr: 22_000_000, createdBy: ids.boss } }));
    expect(await as("hr", (tx) => tx.personCost.count())).toBe(2);
    expect(await as("boss", (tx) => tx.personCost.count())).toBe(2);
    for (const role of ["finance", "pm", "dev", "sales"] as const) {
      expect(await as(role, (tx) => tx.personCost.count())).toBe(0);
      await denied(as(role, (tx) => tx.personCost.create({ data: { userId: ids[role], effectiveFrom: new Date("2026-02-01"), monthlyCostIdr: 1 } })));
    }
  });

  it("lets HR set capacity; PM reads it, Finance doesn't", async () => {
    await as("hr", (tx) => tx.personCapacity.create({ data: { userId: ids.dev, effectiveFrom: from, weeklyHours: 40 } }));
    await as("hr", (tx) => tx.capacityOverride.create({ data: { userId: ids.dev, periodStart: new Date("2026-10-12"), periodEnd: new Date("2026-10-13"), availableHours: 0, reason: "Leave" } }));
    expect(await as("pm", (tx) => tx.personCapacity.count())).toBe(1);
    expect(await as("boss", (tx) => tx.capacityOverride.count())).toBe(1);
    expect(await as("finance", (tx) => tx.personCapacity.count())).toBe(0);
    await denied(as("pm", (tx) => tx.personCapacity.create({ data: { userId: ids.pm, effectiveFrom: from, weeklyHours: 40 } })));
  });

  it("lets HR change utilization targets; C-Level reads them", async () => {
    await as("hr", (tx) => tx.utilizationTarget.update({ where: { role: "designer_dev" }, data: { targetPercent: 75 } }));
    expect(await as("boss", (tx) => tx.utilizationTarget.count())).toBe(5);
    expect(await as("sales", (tx) => tx.utilizationTarget.count())).toBe(0);
    expect((await as("dev", (tx) => tx.utilizationTarget.updateMany({ data: { targetPercent: 1 } }))).count).toBe(0);
  });

  it("keeps revenue targets to C-Level, one yearly row per year", async () => {
    await as("boss", (tx) => tx.revenueTarget.create({ data: { year: 2026, month: null, targetIdr: 2_400_000_000 } }));
    await denied(as("boss", (tx) => tx.revenueTarget.create({ data: { year: 2026, month: null, targetIdr: 1 } })));
    expect(await as("finance", (tx) => tx.revenueTarget.count())).toBe(0);
    await denied(as("hr", (tx) => tx.revenueTarget.create({ data: { year: 2026, month: 1, targetIdr: 1 } })));
  });

  it("lets Finance and C-Level keep FX reference rates", async () => {
    await as("finance", (tx) => tx.fxReferenceRate.create({ data: { currency: "USD", rateToIdr: 16_300, effectiveFrom: from } }));
    expect(await as("boss", (tx) => tx.fxReferenceRate.count())).toBe(1);
    expect(await as("hr", (tx) => tx.fxReferenceRate.count())).toBe(0);
    await denied(as("sales", (tx) => tx.fxReferenceRate.create({ data: { currency: "EUR", rateToIdr: 17_000, effectiveFrom: from } })));
  });

  it("lets only C-Level and admins write the dashboard rules", async () => {
    const write = (tx: Tx) => tx.appSetting.upsert({ where: { key: "project_attention_rules" }, create: { key: "project_attention_rules", value: {} }, update: { value: {} } });
    await denied(as("hr", write));
    await denied(as("finance", write));
    await as("boss", write);
  });

  it("hides the retainer fee like the contract value", async () => {
    await as("sales", (tx) => tx.projectContract.update({ where: { projectId: projectA }, data: { retainerFeePerMonth: 5_000 } }));
    expect(await as("dev", (tx) => tx.projectContract.count())).toBe(0);
    expect(await as("hr", (tx) => tx.projectContract.count())).toBe(0);
  });
});
