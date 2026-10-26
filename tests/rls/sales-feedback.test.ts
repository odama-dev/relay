/**
 * RLS suite for the Sales feedback round (Oct 2026): deal details and the
 * last stage, notes, a manual invoice status, own tasks for every role
 * (Sales into the "Sales" section), project search, and connected mailboxes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";

const ids = { boss: randomUUID(), sales: randomUUID(), sales2: randomUUID(), fin: randomUUID(), dev: randomUUID(), pm: randomUUID(), hr: randomUUID() };
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
    ["sales2", "sales"],
    ["fin", "finance"],
    ["dev", "designer_dev"],
    ["pm", "pm"],
    ["hr", "hr"],
  ];
  for (const [key, role, isAdmin] of people) {
    await prisma.profile.create({ data: { id: ids[key], email: `${key}@sf.test`, fullName: key, role, isAdmin: Boolean(isAdmin), status: "active" } });
  }
  clientId = (await prisma.client.create({ data: { code: "FED", name: "Feed Co" } })).id;
  projectId = (
    await prisma.project.create({
      data: { name: "Feed site", kind: "client", clientId, contractType: "fixed", currency: "IDR", pmId: ids.pm, startDate: new Date("2026-10-01") },
    })
  ).id;
  await prisma.projectContract.create({ data: { projectId, contractValue: 90_000_000 } });
  await prisma.section.create({ data: { projectId, name: "Design", position: 0 } });
});

afterAll(() => prisma.$disconnect());

describe("Deals", () => {
  it("runs the outreach pipeline, with Contacted and Replied driven by email", async () => {
    const stages = await prisma.pipelineStage.findMany({ orderBy: { position: "asc" } });
    expect(stages.map((s) => s.name)).toEqual(["Researched", "Contacted", "Replied", "Call booked", "Proposal", "Won", "Lost"]);
    expect(stages.filter((s) => s.autoKey).map((s) => [s.name, s.autoKey])).toEqual([
      ["Contacted", "contacted"],
      ["Replied", "replied"],
    ]);
  });

  it("keeps the last open stage when a deal closes, and only takes listed lead sources", async () => {
    const d = await as("sales", async (tx) =>
      tx.deal.create({ data: { title: "Lead", prospectName: "Acme", value: 1, stageId: await stage("Call booked"), leadSource: "dribbble", leadType: "inbound" } }),
    );
    expect(d.lastStageId).toBe(await stage("Call booked"));
    const lost = await as("sales", async (tx) => tx.deal.update({ where: { id: d.id }, data: { stageId: await stage("Lost") } }));
    expect(lost.lastStageId).toBe(await stage("Call booked"));
    const edited = await as("sales", async (tx) => tx.deal.update({ where: { id: d.id }, data: { lastStageId: await stage("Proposal") } }));
    expect(edited.lastStageId).toBe(await stage("Proposal"));
    expect(await denied(as("sales", async (tx) => tx.deal.update({ where: { id: d.id }, data: { lastStageId: await stage("Won") } })))).toMatch(/open stage/);
    expect(await denied(as("sales", (tx) => tx.deal.update({ where: { id: d.id }, data: { leadSource: "Upwork" } })))).toMatch(/lead_source/);
  });

  it("lets Sales hide a stage", async () => {
    const id = await stage("Proposal");
    await as("sales", (tx) => tx.pipelineStage.update({ where: { id }, data: { isHidden: true } }));
    expect((await prisma.pipelineStage.findUniqueOrThrow({ where: { id } })).isHidden).toBe(true);
    expect((await as("dev", (tx) => tx.pipelineStage.updateMany({ where: { id }, data: { isHidden: false } }))).count).toBe(0);
  });
});

describe("Notes", () => {
  let noteId: string;

  it("Sales writes notes, stamped with the author", async () => {
    const n = await as("sales", (tx) => tx.crmNote.create({ data: { body: "Called — wants a proposal by Friday", clientId } }));
    noteId = n.id;
    expect(n.authorId).toBe(ids.sales);
    await denied(as("sales", (tx) => tx.crmNote.create({ data: { body: "Orphan" } })));
  });

  it("Sales and Studio Report read them; nobody else", async () => {
    expect(await as("sales2", (tx) => tx.crmNote.count())).toBe(1);
    expect(await as("boss", (tx) => tx.crmNote.count())).toBe(1);
    expect(await as("dev", (tx) => tx.crmNote.count())).toBe(0);
    expect(await as("fin", (tx) => tx.crmNote.count())).toBe(0);
    await denied(as("dev", (tx) => tx.crmNote.create({ data: { body: "x", clientId } })));
  });

  it("only the author edits or deletes a note, and only its text", async () => {
    expect((await as("sales2", (tx) => tx.crmNote.updateMany({ where: { id: noteId }, data: { body: "Hijack" } }))).count).toBe(0);
    expect((await as("sales2", (tx) => tx.crmNote.deleteMany({ where: { id: noteId } }))).count).toBe(0);
    await as("sales", (tx) => tx.crmNote.update({ where: { id: noteId }, data: { body: "Proposal sent" } }));
    await denied(as("sales", (tx) => tx.crmNote.update({ where: { id: noteId }, data: { clientId: null, dealId: null, companyId: null, personId: null } })));
    expect((await as("sales", (tx) => tx.crmNote.deleteMany({ where: { id: noteId } }))).count).toBe(1);
  });
});

describe("Manual invoice status", () => {
  let invoiceId: string;

  beforeAll(async () => {
    invoiceId = (
      await prisma.invoice.create({
        data: { projectId, clientId, currency: "IDR", issueDate: new Date("2026-10-01"), billToName: "Feed Co", total: 1000, subtotal: 1000, status: "draft", createdBy: ids.sales },
      })
    ).id;
  });

  it("can't be set on a draft", async () => {
    expect(await denied(as("sales", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { statusOverride: "paid" } })))).toMatch(/issued/);
  });

  it("Sales / Finance set it on an issued invoice, and it wins over the derived status", async () => {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "sent", number: "ODAMA/26/9001", sentAt: new Date() } });
    const set = await as("sales", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { statusOverride: "paid" } }));
    expect(set.status).toBe("paid");
    expect(set.statusOverrideBy).toBe(ids.sales);
    // The system recomputing the status keeps the manual one.
    const refreshed = await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "overdue" } });
    expect(refreshed.status).toBe("paid");
    expect(await denied(as("fin", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { statusOverride: "void" } })))).toMatch(/void/i);
    expect((await as("dev", (tx) => tx.invoice.updateMany({ where: { id: invoiceId }, data: { statusOverride: "sent" } }))).count).toBe(0);
    await denied(as("sales", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { statusOverrideBy: ids.fin } })));
  });

  it("clearing it hands the status back to the system", async () => {
    const cleared = await as("fin", (tx) => tx.invoice.update({ where: { id: invoiceId }, data: { statusOverride: null } }));
    expect(cleared.statusOverride).toBeNull();
    expect(cleared.statusOverrideBy).toBeNull();
    const derived = await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "overdue" } });
    expect(derived.status).toBe("overdue");
  });
});

describe("Own tasks", () => {
  const join = (user: keyof typeof ids) => as(user, async (tx) => (await tx.$queryRaw<{ sid: string }[]>`SELECT app.join_project_for_task(${projectId}::uuid) AS sid`)[0]!.sid);

  it("anyone finds open projects by search, without contract values", async () => {
    const found = await as("dev", (tx) => tx.$queryRaw<{ id: string; is_member: boolean }[]>`SELECT * FROM app.search_projects('feed')`);
    expect(found.map((p) => p.id)).toContain(projectId);
    expect(found.find((p) => p.id === projectId)!.is_member).toBe(false);
    expect(await as("dev", (tx) => tx.projectContract.count({ where: { projectId } }))).toBe(0);
  });

  it("Sales joins into the project's Sales section and can't add tasks elsewhere", async () => {
    const sid = await join("sales");
    const section = await prisma.section.findUniqueOrThrow({ where: { id: sid } });
    expect(section.name).toBe("Sales");
    const t = await as("sales", (tx) => tx.task.create({ data: { projectId, sectionId: sid, title: "Send renewal", ownerId: ids.sales, createdBy: ids.sales } }));
    expect(t.ownerId).toBe(ids.sales);
    const design = (await prisma.section.findFirstOrThrow({ where: { projectId, name: "Design" } })).id;
    await denied(as("sales", (tx) => tx.task.create({ data: { projectId, sectionId: design, title: "Nope", createdBy: ids.sales } })));
    // Joining again reuses the section.
    expect(await join("sales")).toBe(sid);
    expect(await as("sales", (tx) => tx.task.update({ where: { id: t.id }, data: { title: "Send the renewal" } }))).toBeTruthy();
  });

  it("Finance and HR add their own tasks to the first section", async () => {
    const first = await prisma.section.findFirstOrThrow({ where: { projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    expect(first.name).not.toBe("Sales");
    for (const user of ["fin", "hr"] as const) {
      expect(await join(user)).toBe(first.id);
      const sid = first.id;
      await as(user, (tx) => tx.task.create({ data: { projectId, sectionId: sid, title: `${user} task`, ownerId: ids[user], createdBy: ids[user] } }));
    }
    expect(await as("fin", (tx) => tx.task.count({ where: { projectId } }))).toBe(3);
  });

  it("refuses closed projects", async () => {
    const closed = await prisma.project.create({
      data: { name: "Old", kind: "client", clientId, contractType: "fixed", currency: "IDR", pmId: ids.pm, startDate: new Date("2025-01-01"), status: "completed" },
    });
    expect(await denied(as("dev", (tx) => tx.$queryRaw`SELECT app.join_project_for_task(${closed.id}::uuid)`))).toMatch(/Active or On hold/);
  });
});

describe("Mailboxes", () => {
  let accountId: string;

  it("the owner connects one; the password can't be read back", async () => {
    const a = await as("sales", (tx) =>
      tx.mailAccount.create({
        data: { userId: ids.dev, email: "Sales@Feed.test", imapHost: "imap.feed.test", smtpHost: "smtp.feed.test", username: "sales@feed.test", passwordEnc: "v1:x:y:z" },
        select: { id: true, userId: true, email: true },
      }),
    );
    accountId = a.id;
    expect(a.userId).toBe(ids.sales);
    expect(a.email).toBe("sales@feed.test");
    expect(await denied(as("sales", (tx) => tx.mailAccount.findMany()))).toMatch(/permission denied/);
    expect(await as("sales", (tx) => tx.mailAccount.count())).toBe(1);
  });

  it("nobody else sees or changes it", async () => {
    expect(await as("sales2", (tx) => tx.mailAccount.count())).toBe(0);
    expect(await as("boss", (tx) => tx.mailAccount.count())).toBe(0);
    expect((await as("sales2", (tx) => tx.mailAccount.updateMany({ where: { id: accountId }, data: { shared: false } }))).count).toBe(0);
    await denied(as("sales", (tx) => tx.mailAccount.update({ where: { id: accountId }, data: { lastSyncedAt: new Date() }, select: { id: true } })));
  });

  it("shares linked messages with the Sales team, keeps the rest private, and only the system writes them", async () => {
    const company = await prisma.crmCompany.create({ data: { name: "Feed Co", domain: "feed.co", clientId } });
    await prisma.mailMessage.createMany({
      data: [
        { accountId, messageId: "<a@x>", direction: "inbound", fromEmail: "ceo@feed.co", toEmails: ["sales@feed.test"], sentAt: new Date(), companyId: company.id },
        { accountId, messageId: "<b@x>", direction: "inbound", fromEmail: "friend@gmail.com", toEmails: ["sales@feed.test"], sentAt: new Date() },
      ],
    });
    expect(await as("sales", (tx) => tx.mailMessage.count())).toBe(2);
    expect(await as("sales2", (tx) => tx.mailMessage.count())).toBe(1);
    expect(await as("boss", (tx) => tx.mailMessage.count())).toBe(1);
    expect(await as("dev", (tx) => tx.mailMessage.count())).toBe(0);
    await denied(as("sales", (tx) => tx.mailMessage.create({ data: { accountId, messageId: "<c@x>", direction: "outbound", fromEmail: "x@y.z", toEmails: [], sentAt: new Date() } })));

    await as("sales", (tx) => tx.mailAccount.update({ where: { id: accountId }, data: { shared: false }, select: { id: true } }));
    expect(await as("sales2", (tx) => tx.mailMessage.count())).toBe(0);
    expect(await as("sales", (tx) => tx.mailMessage.count())).toBe(2);
  });

  it("moves deals forward from email: sent → Contacted, answered → Replied, never back", async () => {
    const company = await prisma.crmCompany.findFirstOrThrow({ where: { domain: "feed.co" } });
    const person = await prisma.crmPerson.create({ data: { name: "Nia", email: "nia@other.co" } });
    const mk = async (title: string, stageName: string, link: { companyId?: string; personId?: string }) =>
      (await prisma.deal.create({ data: { title, prospectName: "X", value: 1, stageId: await stage(stageName), leadDate: new Date("2026-01-01"), ...link } })).id;
    const answered = await mk("Answered", "Researched", { companyId: company.id });
    const written = await mk("Written", "Researched", { personId: person.id });
    const ahead = await mk("Ahead", "Proposal", { companyId: company.id });
    await prisma.mailMessage.create({
      data: { accountId, messageId: "<d@x>", direction: "outbound", fromEmail: "sales@feed.test", toEmails: ["nia@other.co"], sentAt: new Date(), personId: person.id },
    });
    await prisma.$queryRaw`SELECT app.mail_advance_deals(${accountId}::uuid)`;
    const get = (id: string) => prisma.deal.findUniqueOrThrow({ where: { id }, include: { stage: true } });
    expect((await get(answered)).stage.name).toBe("Replied");
    expect((await get(written)).stage.name).toBe("Contacted");
    expect((await get(written)).lastContactOn).not.toBeNull();
    expect((await get(ahead)).stage.name).toBe("Proposal");
    expect(await prisma.dealStageHistory.count({ where: { dealId: written } })).toBe(2);
    expect(await denied(as("sales", (tx) => tx.$queryRaw`SELECT app.mail_advance_deals(NULL)`))).toMatch(/permission denied/);
    expect(await denied(as("sales", async (tx) => tx.pipelineStage.update({ where: { id: await stage("Proposal") }, data: { autoKey: "contacted" } })))).toMatch(/system/);
  });
});
