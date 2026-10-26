/**
 * RLS suite for Phase 2 · M9 Sales: module access to the pipeline, stage
 * rules and history, and the payment-proof flow (Sales submits, Finance
 * verifies or rejects, never their own).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";
import { proofRejected, proofSubmitted, proofVerified } from "@/lib/invoices/payments";
import { projectForWonDeal } from "@/lib/sales/won";
import type { Viewer } from "@/lib/roles";

const ids = { boss: randomUUID(), sales: randomUUID(), fin: randomUUID(), dev: randomUUID(), pm: randomUUID() };
const as = <T>(user: keyof typeof ids, fn: (tx: Tx) => Promise<T>) => withRls(ids[user], fn);

async function denied(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the database to refuse this");
}

const stage = async (name: string) => (await prisma.pipelineStage.findFirstOrThrow({ where: { name } })).id;
let projectId: string;
let clientId: string;

beforeAll(async () => {
  const people: [keyof typeof ids, UserRole, boolean?][] = [
    ["boss", "c_level", true],
    ["sales", "sales"],
    ["fin", "finance"],
    ["dev", "designer_dev"],
    ["pm", "pm"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@m9.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
  clientId = (await prisma.client.create({ data: { code: "SAL", name: "Sale Co" } })).id;
  projectId = (
    await prisma.project.create({ data: { name: "Site", kind: "client", clientId, contractType: "fixed", currency: "IDR", pmId: ids.pm, startDate: new Date("2026-10-01") } })
  ).id;
});

afterAll(() => prisma.$disconnect());

describe("Pipeline", () => {
  let dealId: string;

  it("shows the pipeline to Sales and Studio Report only", async () => {
    expect(await as("sales", (tx) => tx.pipelineStage.count())).toBe(7);
    expect(await as("boss", (tx) => tx.pipelineStage.count())).toBe(7);
    expect(await as("dev", (tx) => tx.pipelineStage.count())).toBe(0);
    expect(await as("fin", (tx) => tx.pipelineStage.count())).toBe(0);
    await denied(as("dev", async (tx) => tx.deal.create({ data: { title: "Nope", prospectName: "X", value: 1, stageId: await stage("Researched") } })));
  });

  it("records every stage entry and takes the stage's probability", async () => {
    const d = await as("sales", async (tx) => tx.deal.create({ data: { title: "Website", prospectName: "Newco", value: 100_000_000, probability: 10, stageId: await stage("Researched") } }));
    dealId = d.id;
    expect(d.createdBy).toBe(ids.sales);
    const moved = await as("sales", async (tx) => tx.deal.update({ where: { id: dealId }, data: { stageId: await stage("Contacted") } }));
    expect(moved.probability).toBe(15);
    const history = await prisma.dealStageHistory.findMany({ where: { dealId }, orderBy: { changedAt: "asc" } });
    expect(history).toHaveLength(2);
    expect(history[1]!.changedBy).toBe(ids.sales);
    await denied(as("sales", async (tx) => tx.dealStageHistory.create({ data: { dealId, toStageId: await stage("Won"), value: 1, currency: "IDR" } })));
  });

  it("closes a lost deal, with or without a reason", async () => {
    const bare = await as("sales", async (tx) => tx.deal.update({ where: { id: dealId }, data: { stageId: await stage("Lost") } }));
    expect(bare.lostReason).toBeNull();
    await as("sales", async (tx) => tx.deal.update({ where: { id: dealId }, data: { stageId: await stage("Proposal") } }));
    const lost = await as("sales", async (tx) => tx.deal.update({ where: { id: dealId }, data: { stageId: await stage("Lost"), lostReason: "Budget" } }));
    expect(lost.probability).toBe(0);
    expect(lost.closedAt).not.toBeNull();
    const reopened = await as("sales", async (tx) => tx.deal.update({ where: { id: dealId }, data: { stageId: await stage("Proposal") } }));
    expect(reopened.closedAt).toBeNull();
    expect(reopened.lostReason).toBeNull();
  });

  it("links a project only once the deal is won", async () => {
    expect(await denied(as("sales", (tx) => tx.deal.update({ where: { id: dealId }, data: { projectId } })))).toMatch(/won/);
    await as("sales", async (tx) => tx.deal.update({ where: { id: dealId }, data: { stageId: await stage("Won") } }));
    const won = await as("sales", (tx) => tx.deal.update({ where: { id: dealId }, data: { projectId, clientId, prospectName: null } }));
    expect(won.probability).toBe(100);
    expect(won.projectId).toBe(projectId);
    expect(await denied(as("sales", (tx) => tx.deal.update({ where: { id: dealId }, data: { clientId: null, prospectName: "Other" } })))).toMatch(/client is fixed/);
  });

  it("turns a won deal into a client and an Active project, as Sales", async () => {
    const sales = { id: ids.sales, role: "sales", isAdmin: false, accessLevel: "member", modules: ["sales"] } as unknown as Viewer;
    const opts = { today: "2026-10-26", thresholds: [80, 100, 80] };
    const company = await as("sales", (tx) => tx.crmCompany.create({ data: { name: "Kopi Senja" } }));
    const deal = (title: string, companyId?: string) =>
      as("sales", async (tx) =>
        tx.deal.create({ data: { title, prospectName: "Kopi Senja", companyId, value: 50_000_000, stageId: await stage("Proposal") } }),
      );
    const first = await deal("Brand refresh", company.id);
    expect(await as("sales", (tx) => projectForWonDeal(tx, sales, first.id, opts))).toBeNull();

    await as("sales", async (tx) => tx.deal.update({ where: { id: first.id }, data: { stageId: await stage("Won") } }));
    const made = await as("sales", (tx) => projectForWonDeal(tx, sales, first.id, opts));
    expect(made?.clientCreated).toBe(true);
    const client = await prisma.client.findUniqueOrThrow({ where: { id: made!.clientId } });
    expect([client.code, client.name, client.defaultCurrency]).toEqual(["KS", "Kopi Senja", "IDR"]);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: made!.id }, include: { contract: true, budget: true } });
    expect([project.code, project.status, project.contractType, project.pmId]).toEqual(["KS-001", "active", "fixed", ids.boss]);
    expect(Number(project.contract?.contractValue)).toBe(50_000_000);
    expect(project.budget?.alertThresholds).toEqual([80, 100]);
    expect((await prisma.crmCompany.findUniqueOrThrow({ where: { id: company.id } })).clientId).toBe(client.id);
    expect(await as("sales", (tx) => projectForWonDeal(tx, sales, first.id, opts))).toBeNull();

    // A second deal for the same prospect joins the same client.
    const second = await deal("Website care");
    await as("sales", async (tx) => tx.deal.update({ where: { id: second.id }, data: { stageId: await stage("Won") } }));
    const again = await as("sales", (tx) => projectForWonDeal(tx, sales, second.id, opts));
    expect([again?.clientId, again?.clientCreated, again?.code]).toEqual([client.id, false, "KS-002"]);
  });

  it("keeps stages with deals, and one stage per category", async () => {
    expect(await denied(as("sales", async (tx) => tx.pipelineStage.delete({ where: { id: await stage("Won") } })))).toMatch(/Move this stage/);
    expect(await denied(as("sales", async (tx) => tx.pipelineStage.delete({ where: { id: await stage("Lost") } })))).toMatch(/at least one Lost/);
    await as("sales", async (tx) => tx.pipelineStage.delete({ where: { id: await stage("Researched") } }));
    await denied(as("boss", async (tx) => tx.pipelineStage.create({ data: { name: "Nope", category: "open", probability: 120 } })));
  });
});

describe("Payment proofs", () => {
  let invoiceId: string;
  let requestId: string;

  beforeAll(async () => {
    const inv = await prisma.invoice.create({
      data: {
        projectId,
        clientId,
        currency: "IDR",
        issueDate: new Date("2026-10-01"),
        billToName: "Sale Co",
        total: 1_000_000,
        subtotal: 1_000_000,
        status: "sent",
        number: "ODAMA/26/9001",
        platform: "bank_transfer",
        createdBy: ids.sales,
        paymentRequests: { create: [{ label: "Full", amount: 1_000_000, dueDate: new Date("2099-01-01"), position: 0 }] },
      },
      include: { paymentRequests: true },
    });
    invoiceId = inv.id;
    requestId = inv.paymentRequests[0]!.id;
  });

  const submit = (who: keyof typeof ids, amount = 1_000_000) =>
    as(who, (tx) =>
      tx.paymentProof.create({ data: { invoiceId, paymentRequestId: requestId, amount, currency: "USD", paidOn: new Date("2026-10-20"), platform: "bank_transfer", submittedBy: ids[who] } }),
    );

  it("lets Sales submit; the invoice waits on Finance", async () => {
    const p = await submit("sales");
    expect(p.currency).toBe("IDR"); // the invoice's, whatever was sent
    expect(p.status).toBe("submitted");
    await proofSubmitted(p.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("payment_submitted");
    await denied(submit("fin"));
    expect(await as("dev", (tx) => tx.paymentProof.count())).toBe(0);
    expect(await as("fin", (tx) => tx.paymentProof.count())).toBe(1);
  });

  it("lets only Finance decide, with a note to reject", async () => {
    const p = await prisma.paymentProof.findFirstOrThrow({ where: { invoiceId } });
    expect(await as("sales", (tx) => tx.paymentProof.updateMany({ where: { id: p.id }, data: { status: "verified" } }))).toEqual({ count: 0 });
    expect(await denied(as("fin", (tx) => tx.paymentProof.update({ where: { id: p.id }, data: { status: "rejected" } })))).toMatch(/note/);
    await denied(as("fin", (tx) => tx.paymentProof.update({ where: { id: p.id }, data: { status: "rejected", reviewNote: "x", amount: 5 } })));
    const rejected = await as("fin", (tx) => tx.paymentProof.update({ where: { id: p.id }, data: { status: "rejected", reviewNote: "Not in the account" } }));
    expect(rejected.reviewedBy).toBe(ids.fin);
    await proofRejected(p.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("sent");
    expect(await denied(as("fin", (tx) => tx.paymentProof.update({ where: { id: p.id }, data: { status: "verified" } })))).toMatch(/already been decided/);
  });

  it("never lets someone verify their own proof", async () => {
    const own = await submit("boss");
    expect(await denied(as("boss", (tx) => tx.paymentProof.update({ where: { id: own.id }, data: { status: "verified" } })))).toMatch(/Someone else/);
    await as("fin", (tx) => tx.paymentProof.update({ where: { id: own.id }, data: { status: "rejected", reviewNote: "Duplicate" } }));
  });

  it("turns a verified proof into a payment: the invoice is Paid", async () => {
    const p = await submit("sales");
    await proofSubmitted(p.id);
    await as("fin", (tx) => tx.paymentProof.update({ where: { id: p.id }, data: { status: "verified" } }));
    await proofVerified(p.id, ids.fin);
    await proofVerified(p.id, ids.fin); // idempotent
    const payments = await prisma.payment.findMany({ where: { invoiceId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ source: "proof", paymentRequestId: requestId, matchedBy: ids.fin });
    expect(Number(payments[0]!.settlementAmountIdr)).toBe(1_000_000);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { paymentRequests: true } });
    expect(inv.status).toBe("paid");
    expect(inv.paymentRequests[0]!.status).toBe("paid");
    // Nothing more to prove on a paid invoice.
    expect(await denied(submit("sales"))).toMatch(/isn't paid yet/);
  });

  it("enables RLS on the Sales tables and grants nothing to anon", async () => {
    const tables = ["pipeline_stages", "deals", "deal_stage_history", "pipeline_snapshots", "payment_proofs"];
    const rows = await prisma.$queryRaw<{ rls: boolean }[]>`
      SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tables})`;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.rls)).toBe(true);
    const anon = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_name = ANY(${tables})`;
    expect(Number(anon[0]!.n)).toBe(0);
  });
});
