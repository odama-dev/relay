"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { normalizeValue, optionsSchema, type CrmValue } from "@/lib/crm/pure";
import { getPersonRecord, type PersonRecord } from "@/lib/crm/person-record";
import { getCompanyRecord, type CompanyRecord } from "@/lib/crm/company-record";
import { prisma } from "@/lib/prisma";
import { COUNTRIES } from "@/lib/geo/countries";
import { parseIsoDate } from "@/lib/time/pure";
import { CRM_OBJECTS, crmColumnEditSchema, crmColumnSchema, crmCompanySchema, crmFieldSchema, crmNoteEditSchema, crmNoteSchema, crmPersonSchema, uuid } from "@/lib/validation";

/**
 * Sales CRM — Companies and People. Writes run under RLS (Sales module);
 * values are checked against their column's type before they're stored.
 */

const FORBIDDEN = "Only people with the Sales module edit companies and people.";

function revalidateCrm() {
  revalidatePath("/sales/companies");
  revalidatePath("/sales/people");
}

async function salesUser() {
  const user = await requireUser();
  if (!perms.manageDeals(user)) fail(FORBIDDEN);
  return user;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export async function createColumn(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmColumnSchema, raw);
    const options = parseOrFail(optionsSchema, d.type === "select" || d.type === "multi_select" ? d.options : []);
    if ((d.type === "select" || d.type === "multi_select") && options.length === 0) fail("Add at least one option.");
    const col = await asUser(user, async (tx) => {
      const last = await tx.crmAttribute.aggregate({ where: { object: d.object }, _max: { position: true } });
      return tx.crmAttribute.create({ data: { object: d.object, name: d.name, type: d.type, options, position: (last._max.position ?? -1) + 1 } });
    });
    await logActivity({ actorId: user.id, entityType: "crm_column", entityId: col.id, action: "created", metadata: { object: d.object, name: d.name, type: d.type } });
    revalidateCrm();
  });
}

/** Rename, or change a select's options (an option in use keeps its id, so values survive a rename). */
export async function updateColumn(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const colId = parseOrFail(uuid, id);
    const d = parseOrFail(crmColumnEditSchema, raw);
    const options = parseOrFail(optionsSchema, d.options);
    const res = await asUser(user, (tx) => tx.crmAttribute.updateMany({ where: { id: colId }, data: { name: d.name, options } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "crm_column", entityId: colId, action: "updated", metadata: { name: d.name } });
    revalidateCrm();
  });
}

/** Hidden from the table; values stay on the records. */
export async function archiveColumn(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const colId = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.crmAttribute.updateMany({ where: { id: colId, archivedAt: null }, data: { archivedAt: new Date() } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "crm_column", entityId: colId, action: "archived" });
    revalidateCrm();
  });
}

/** Move a column one place left (-1) or right (1). */
export async function moveColumn(id: unknown, direction: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const colId = parseOrFail(uuid, id);
    const dir = parseOrFail(z.union([z.literal(-1), z.literal(1)]), direction);
    await asUser(user, async (tx) => {
      const col = await tx.crmAttribute.findUnique({ where: { id: colId }, select: { object: true } });
      if (!col) fail("Column not found.");
      const cols = await tx.crmAttribute.findMany({ where: { object: col.object, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
      const i = cols.findIndex((c) => c.id === colId);
      const j = i + dir;
      if (j < 0 || j >= cols.length) return;
      [cols[i], cols[j]] = [cols[j]!, cols[i]!];
      for (const [position, c] of cols.entries()) await tx.crmAttribute.update({ where: { id: c.id }, data: { position } });
    });
    revalidateCrm();
  });
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

type CompanyInput = z.output<typeof crmCompanySchema>;
type PersonInput = z.output<typeof crmPersonSchema>;

const socialData = (d: CompanyInput | PersonInput) => ({
  angellist: d.angellist ?? null,
  facebook: d.facebook ?? null,
  instagram: d.instagram ?? null,
  linkedin: d.linkedin ?? null,
  twitter: d.twitter ?? null,
  twitterFollowers: d.twitterFollowers,
});

/** The company's own columns; the primary `domain` follows `domains` (crm_companies_lists). */
const companyData = (d: CompanyInput) => ({
  name: d.name,
  domains: d.domains,
  description: d.description ?? null,
  country: d.country,
  categories: d.categories,
  ...socialData(d),
  estimatedArr: d.estimatedArr,
  fundingRaised: d.fundingRaised,
  fundingCurrency: d.fundingRaised === null ? null : d.fundingCurrency,
  foundedOn: d.foundedOn ? parseIsoDate(d.foundedOn) : null,
  employeeRange: d.employeeRange,
});

/** The person's own columns; the primary `email` / `phone` follow their lists (crm_people_lists). `companyId` is resolved first (resolveCompany). */
const personData = (d: PersonInput, companyId: string | null) => ({
  name: d.name,
  emails: d.emails,
  phones: d.phones,
  description: d.description ?? null,
  companyId,
  jobTitle: d.jobTitle ?? null,
  country: d.country,
  ...socialData(d),
});

/**
 * The company's team (people at it) and associated deals. Names typed into
 * the team become new people at the company, to fill in later on People. A
 * deal follows its company's client, like the deal form; one with a project
 * keeps its client (deals_derive), so it neither joins nor leaves. `replace`
 * drops what was unticked on an edit.
 */
async function linkCompany(tx: Prisma.TransactionClient, companyId: string, d: CompanyInput, replace: boolean, ownerId: string) {
  const company = await tx.crmCompany.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, clientId: true } });
  if (replace) await tx.crmPerson.updateMany({ where: { companyId, id: { notIn: d.team.ids } }, data: { companyId: null } });
  if (d.team.ids.length) await tx.crmPerson.updateMany({ where: { id: { in: d.team.ids }, archivedAt: null }, data: { companyId } });
  if (d.team.names.length) await tx.crmPerson.createMany({ data: d.team.names.map((name) => ({ name, companyId, country: d.country, ownerId })) });
  if (replace) {
    const gone = await tx.deal.findMany({ where: { companyId, projectId: null, id: { notIn: d.dealIds } }, select: { id: true, title: true, person: { select: { name: true } } } });
    for (const g of gone) await tx.deal.update({ where: { id: g.id }, data: { companyId: null, clientId: null, prospectName: g.person?.name ?? g.title } });
  }
  if (d.dealIds.length) {
    await tx.deal.updateMany({
      where: { id: { in: d.dealIds }, projectId: null },
      data: { companyId, clientId: company.clientId, prospectName: company.clientId ? null : company.name },
    });
  }
}

/** A person's company: the one picked, or a new one by the name typed (its details are filled in later on Companies). */
async function resolveCompany(tx: Prisma.TransactionClient, d: PersonInput, ownerId: string): Promise<string | null> {
  if (!d.company) return null;
  if (d.company.id !== null) return d.company.id;
  const c = await tx.crmCompany.create({ data: { name: d.company.name, country: d.country, ownerId }, select: { id: true } });
  return c.id;
}

/** The person's associated deals (the deal's contact). */
async function linkPerson(tx: Prisma.TransactionClient, personId: string, dealIds: string[], replace: boolean) {
  if (replace) await tx.deal.updateMany({ where: { personId, id: { notIn: dealIds } }, data: { personId: null } });
  if (dealIds.length) await tx.deal.updateMany({ where: { id: { in: dealIds } }, data: { personId } });
}

/** Linked deals may now match synced mail (Contacted / Replied move by themselves). */
async function afterDealLinks(dealIds: string[]) {
  revalidatePath("/sales");
  if (dealIds.length) await prisma.$queryRaw`SELECT app.mail_advance_deals(NULL)`;
}

export async function createCompany(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmCompanySchema, raw);
    const c = await asUser(user, async (tx) => {
      const c = await tx.crmCompany.create({ data: { ...companyData(d), ownerId: user.id } });
      await linkCompany(tx, c.id, d, false, user.id);
      return c;
    });
    await logActivity({ actorId: user.id, entityType: "crm_company", entityId: c.id, action: "created", metadata: { name: d.name, team: d.team.ids.length, newPeople: d.team.names.length, deals: d.dealIds.length } });
    revalidateCrm();
    await afterDealLinks(d.dealIds);
    return { id: c.id };
  });
}

export async function updateCompany(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const companyId = parseOrFail(uuid, id);
    const d = parseOrFail(crmCompanySchema, raw);
    await asUser(user, async (tx) => {
      const res = await tx.crmCompany.updateMany({ where: { id: companyId, archivedAt: null }, data: companyData(d) });
      if (res.count === 0) fail(FORBIDDEN);
      await linkCompany(tx, companyId, d, true, user.id);
    });
    await logActivity({ actorId: user.id, entityType: "crm_company", entityId: companyId, action: "updated", metadata: { name: d.name } });
    revalidateCrm();
    await afterDealLinks(d.dealIds);
  });
}

export async function createPerson(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmPersonSchema, raw);
    const p = await asUser(user, async (tx) => {
      const p = await tx.crmPerson.create({ data: { ...personData(d, await resolveCompany(tx, d, user.id)), ownerId: user.id } });
      await linkPerson(tx, p.id, d.dealIds, false);
      return p;
    });
    await logActivity({ actorId: user.id, entityType: "crm_person", entityId: p.id, action: "created", metadata: { name: d.name, deals: d.dealIds.length } });
    revalidateCrm();
    await afterDealLinks(d.dealIds);
    return { id: p.id };
  });
}

export async function updatePerson(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const personId = parseOrFail(uuid, id);
    const d = parseOrFail(crmPersonSchema, raw);
    await asUser(user, async (tx) => {
      const res = await tx.crmPerson.updateMany({ where: { id: personId, archivedAt: null }, data: personData(d, await resolveCompany(tx, d, user.id)) });
      if (res.count === 0) fail(FORBIDDEN);
      await linkPerson(tx, personId, d.dealIds, true);
    });
    await logActivity({ actorId: user.id, entityType: "crm_person", entityId: personId, action: "updated", metadata: { name: d.name } });
    revalidateCrm();
    await afterDealLinks(d.dealIds);
  });
}

/** Built-in fields per object and how each is checked. */
const BUILTIN: Record<(typeof CRM_OBJECTS)[number], Record<string, z.ZodType>> = {
  company: {
    name: z.string().trim().min(1, "A name is required").max(160),
    domain: z.string().trim().max(200).nullable(),
    country: z.enum(COUNTRIES).nullable(),
    description: z.string().trim().max(4000).nullable(),
    ownerId: z.string().uuid().nullable(),
  },
  person: {
    name: z.string().trim().min(1, "A name is required").max(160),
    email: z.string().trim().toLowerCase().email("Enter a valid email").nullable(),
    phone: z.string().trim().max(40).nullable(),
    jobTitle: z.string().trim().max(120).nullable(),
    country: z.enum(COUNTRIES).nullable(),
    companyId: z.string().uuid().nullable(),
    ownerId: z.string().uuid().nullable(),
  },
};

/** Edit one cell — a built-in field, or a custom column's value. */
export async function setField(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmFieldSchema, raw);
    const builtin = BUILTIN[d.object][d.key];
    await asUser(user, async (tx) => {
      const model = d.object === "company" ? tx.crmCompany : tx.crmPerson;
      if (builtin) {
        const value = parseOrFail(builtin, d.value === "" ? null : d.value);
        // `model` is a union of two delegates; both take the same simple update.
        const res = await (model as typeof tx.crmCompany).updateMany({ where: { id: d.id }, data: { [d.key]: value } as Prisma.CrmCompanyUpdateManyMutationInput });
        if (res.count === 0) fail(FORBIDDEN);
        return;
      }
      const col = await tx.crmAttribute.findFirst({ where: { id: parseOrFail(uuid, d.key), object: d.object, archivedAt: null } });
      if (!col) fail("That column no longer exists.");
      const n = normalizeValue(col.type, optionsSchema.catch([]).parse(col.options), d.value);
      if (!n.ok) fail(n.error);
      const rec = await (model as typeof tx.crmCompany).findUnique({ where: { id: d.id }, select: { values: true } });
      if (!rec) fail("Record not found.");
      const values = { ...((rec.values ?? {}) as Record<string, CrmValue>) };
      if (n.value === null) delete values[col.id];
      else values[col.id] = n.value;
      const res = await (model as typeof tx.crmCompany).updateMany({ where: { id: d.id }, data: { values: values as Prisma.InputJsonValue } });
      if (res.count === 0) fail(FORBIDDEN);
    });
    revalidateCrm();
  });
}

/** Archive (hide) a company or person. People at an archived company keep their other details. */
export async function archiveRecords(object: unknown, ids: unknown): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const user = await salesUser();
    const obj = parseOrFail(z.enum(CRM_OBJECTS), object);
    const list = parseOrFail(z.array(uuid).min(1).max(500), ids);
    const res = await asUser(user, (tx) =>
      obj === "company"
        ? tx.crmCompany.updateMany({ where: { id: { in: list }, archivedAt: null }, data: { archivedAt: new Date() } })
        : tx.crmPerson.updateMany({ where: { id: { in: list }, archivedAt: null }, data: { archivedAt: new Date() } }),
    );
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: obj === "company" ? "crm_company" : "crm_person", entityId: list[0]!, action: "archived", metadata: { count: res.count } });
    revalidateCrm();
    return { count: res.count };
  });
}

// ---------------------------------------------------------------------------
// Notes — on a client, company, person or deal. Authors edit and delete
// their own (RLS: crm_notes_*).
// ---------------------------------------------------------------------------

function revalidateNotes(n: { clientId?: string | null }) {
  if (n.clientId) revalidatePath(`/clients/${n.clientId}`);
  revalidatePath("/sales");
}

export async function addNote(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmNoteSchema, raw);
    const note = await asUser(user, (tx) =>
      tx.crmNote.create({
        data: { body: d.body, clientId: d.clientId ?? null, companyId: d.companyId ?? null, personId: d.personId ?? null, dealId: d.dealId ?? null },
      }),
    );
    await logActivity({ actorId: user.id, entityType: "crm_note", entityId: note.id, action: "created", metadata: { clientId: d.clientId, companyId: d.companyId, personId: d.personId, dealId: d.dealId } });
    revalidateNotes(note);
    return { id: note.id };
  });
}

export async function editNote(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const noteId = parseOrFail(uuid, id);
    const d = parseOrFail(crmNoteEditSchema, raw);
    const note = await asUser(user, async (tx) => {
      const res = await tx.crmNote.updateMany({ where: { id: noteId }, data: { body: d.body } });
      if (res.count === 0) fail("You can only edit your own notes.");
      return tx.crmNote.findUniqueOrThrow({ where: { id: noteId }, select: { clientId: true } });
    });
    await logActivity({ actorId: user.id, entityType: "crm_note", entityId: noteId, action: "updated" });
    revalidateNotes(note);
  });
}

export async function deleteNote(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await salesUser();
    const noteId = parseOrFail(uuid, id);
    const note = await asUser(user, async (tx) => {
      const n = await tx.crmNote.findUnique({ where: { id: noteId }, select: { clientId: true, body: true } });
      if (!n) fail("Note not found.");
      const res = await tx.crmNote.deleteMany({ where: { id: noteId } });
      if (res.count === 0) fail("You can only delete your own notes.");
      return n;
    });
    await logActivity({ actorId: user.id, entityType: "crm_note", entityId: noteId, action: "deleted", metadata: { body: note.body.slice(0, 200) } });
    revalidateNotes(note);
  });
}

/** The person side panel's data (`?person=<id>` on People), read under RLS. */
export async function loadPersonRecord(personId: unknown): Promise<PersonRecord> {
  const user = await requireUser();
  const id = uuid.safeParse(personId);
  if (!id.success || !perms.viewPipeline(user)) throw new Error("Person not found");
  const record = await getPersonRecord(user, id.data);
  if (!record) throw new Error("Person not found");
  return record;
}

/** The company side panel's data (`?company=<id>` on Companies), read under RLS. */
export async function loadCompanyRecord(companyId: unknown): Promise<CompanyRecord> {
  const user = await requireUser();
  const id = uuid.safeParse(companyId);
  if (!id.success || !perms.viewPipeline(user)) throw new Error("Company not found");
  const record = await getCompanyRecord(user, id.data);
  if (!record) throw new Error("Company not found");
  return record;
}
