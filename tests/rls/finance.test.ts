/**
 * RLS suite for Phase 2 · M10 Finance: obligations kept by the Finance
 * module (all kinds) and the People module (payroll and BPJS), read by
 * Studio Report, and marked done per occurrence.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = { boss: randomUUID(), fin: randomUUID(), hr: randomUUID(), dev: randomUUID(), sales: randomUUID() };
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

beforeAll(async () => {
  const people: [keyof typeof ids, UserRole, boolean?][] = [
    ["boss", "c_level", true],
    ["fin", "finance"],
    ["hr", "hr"],
    ["dev", "designer_dev"],
    ["sales", "sales"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@m10.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
});

afterAll(() => prisma.$disconnect());

describe("Obligations", () => {
  it("ships the default calendar, seen by module", async () => {
    expect(await as("fin", (tx) => tx.obligation.count())).toBe(5);
    expect(await as("boss", (tx) => tx.obligation.count())).toBe(5);
    // HR (People module) sees payroll and BPJS only.
    expect((await as("hr", (tx) => tx.obligation.findMany())).map((o) => o.kind).sort()).toEqual(["bpjs", "payroll"]);
    expect(await as("dev", (tx) => tx.obligation.count())).toBe(0);
    expect(await as("sales", (tx) => tx.obligation.count())).toBe(0);
  });

  it("lets Finance add any kind and People only payroll / BPJS", async () => {
    const tax = await as("fin", (tx) => tx.obligation.create({ data: { title: "PPN", kind: "tax", recurrence: "monthly", dayOfMonth: 31 } }));
    expect(tax.createdBy).toBe(ids.fin);
    await as("hr", (tx) => tx.obligation.create({ data: { title: "THR", kind: "payroll", recurrence: "yearly", dayOfMonth: 20, month: 3 } }));
    await denied(as("hr", (tx) => tx.obligation.create({ data: { title: "Nope", kind: "tax", recurrence: "monthly", dayOfMonth: 1 } })));
    await denied(as("sales", (tx) => tx.obligation.create({ data: { title: "Nope", kind: "other", recurrence: "monthly", dayOfMonth: 1 } })));
    expect(await as("hr", (tx) => tx.obligation.updateMany({ where: { id: tax.id }, data: { title: "Hidden" } }))).toEqual({ count: 0 });
  });

  it("checks the shape of the date", async () => {
    await denied(as("fin", (tx) => tx.obligation.create({ data: { title: "x", kind: "tax", recurrence: "yearly", dayOfMonth: 30 } })));
    await denied(as("fin", (tx) => tx.obligation.create({ data: { title: "x", kind: "tax", recurrence: "monthly", dayOfMonth: 32 } })));
    const once = await as("fin", (tx) => tx.obligation.create({ data: { title: "Audit", kind: "other", recurrence: "once", dayOfMonth: 1, onDate: day("2026-12-18"), month: 4 } }));
    expect(once).toMatchObject({ dayOfMonth: 18, month: null });
  });

  it("marks an occurrence done once, by someone who keeps that kind", async () => {
    const payroll = await prisma.obligation.findFirstOrThrow({ where: { kind: "payroll", title: "Payroll" } });
    const tax = await prisma.obligation.findFirstOrThrow({ where: { title: "PPN" } });
    const done = await as("hr", (tx) => tx.obligationCompletion.create({ data: { obligationId: payroll.id, dueDate: day("2026-10-25") } }));
    expect(done.doneBy).toBe(ids.hr);
    await denied(as("fin", (tx) => tx.obligationCompletion.create({ data: { obligationId: payroll.id, dueDate: day("2026-10-25") } })));
    await denied(as("hr", (tx) => tx.obligationCompletion.create({ data: { obligationId: tax.id, dueDate: day("2026-10-31") } })));
    expect(await as("fin", (tx) => tx.obligationCompletion.count())).toBe(1);
    expect(await as("dev", (tx) => tx.obligationCompletion.count())).toBe(0);
    await as("fin", (tx) => tx.obligationCompletion.deleteMany({ where: { obligationId: payroll.id } }));
    expect(await prisma.obligationCompletion.count()).toBe(0);
  });

  it("enables RLS and grants nothing to anon", async () => {
    const tables = ["obligations", "obligation_completions"];
    const rows = await prisma.$queryRaw<{ rls: boolean }[]>`
      SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tables})`;
    expect(rows.every((r) => r.rls)).toBe(true);
    expect(rows).toHaveLength(2);
    const anon = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name = ANY(${tables})`;
    expect(Number(anon[0]!.n)).toBe(0);
  });
});
