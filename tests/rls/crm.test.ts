/**
 * RLS suite for the Sales CRM: Companies, People and their custom columns —
 * the Sales module edits, Studio Report reads, everyone else sees nothing.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = { boss: randomUUID(), sales: randomUUID(), dev: randomUUID(), fin: randomUUID() };
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
    ["sales", "sales"],
    ["dev", "designer_dev"],
    ["fin", "finance"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@crm.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
});

afterAll(() => prisma.$disconnect());

describe("Sales CRM", () => {
  it("lets Sales add companies, people (with or without one) and columns", async () => {
    const co = await as("sales", (tx) => tx.crmCompany.create({ data: { name: "Kopi Senja" } }));
    expect(co.createdBy).toBe(ids.sales);
    await as("sales", (tx) => tx.crmPerson.create({ data: { name: "Sari", companyId: co.id } }));
    await as("sales", (tx) => tx.crmPerson.create({ data: { name: "Freelance Budi" } }));
    const col = await as("sales", (tx) =>
      tx.crmAttribute.create({ data: { object: "person", name: "Tags", type: "multi_select", options: [{ id: "a", label: "Hot", color: "red" }] } }),
    );
    expect(await as("sales", (tx) => tx.crmPerson.count())).toBe(2);
    expect(await denied(as("sales", (tx) => tx.crmAttribute.update({ where: { id: col.id }, data: { type: "text" } })))).toMatch(/type can't change/);
  });

  it("lets Studio Report read but not write, and hides it from everyone else", async () => {
    expect(await as("boss", (tx) => tx.crmCompany.count())).toBe(1);
    expect(await as("dev", (tx) => tx.crmCompany.count())).toBe(0);
    expect(await as("fin", (tx) => tx.crmPerson.count())).toBe(0);
    await denied(as("dev", (tx) => tx.crmCompany.create({ data: { name: "Nope" } })));
    expect(await as("fin", (tx) => tx.crmPerson.updateMany({ data: { name: "x" } }))).toEqual({ count: 0 });
  });

  it("archives instead of deleting, and keeps values an object", async () => {
    await denied(as("sales", (tx) => tx.crmCompany.deleteMany({})));
    await denied(as("sales", (tx) => tx.crmPerson.updateMany({ data: { values: ["x"] } })));
    await denied(as("sales", (tx) => tx.crmCompany.create({ data: { name: "  " } })));
  });

  it("enables RLS and grants nothing to anon", async () => {
    const tables = ["crm_attributes", "crm_companies", "crm_people"];
    const rows = await prisma.$queryRaw<{ rls: boolean }[]>`
      SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tables})`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.rls)).toBe(true);
    const anon = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name = ANY(${tables})`;
    expect(Number(anon[0]!.n)).toBe(0);
  });
});
