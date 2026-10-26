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

export async function createCompany(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmCompanySchema, raw);
    const c = await asUser(user, (tx) => tx.crmCompany.create({ data: { name: d.name, domain: d.domain ?? null, ownerId: user.id } }));
    await logActivity({ actorId: user.id, entityType: "crm_company", entityId: c.id, action: "created", metadata: { name: d.name } });
    revalidateCrm();
    return { id: c.id };
  });
}

export async function createPerson(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await salesUser();
    const d = parseOrFail(crmPersonSchema, raw);
    const p = await asUser(user, (tx) => tx.crmPerson.create({ data: { name: d.name, email: d.email ?? null, companyId: d.companyId ?? null, ownerId: user.id } }));
    await logActivity({ actorId: user.id, entityType: "crm_person", entityId: p.id, action: "created", metadata: { name: d.name } });
    revalidateCrm();
    return { id: p.id };
  });
}

/** Built-in fields per object and how each is checked. */
const BUILTIN: Record<(typeof CRM_OBJECTS)[number], Record<string, z.ZodType>> = {
  company: {
    name: z.string().trim().min(1, "A name is required").max(160),
    domain: z.string().trim().max(200).nullable(),
    description: z.string().trim().max(4000).nullable(),
    ownerId: z.string().uuid().nullable(),
  },
  person: {
    name: z.string().trim().min(1, "A name is required").max(160),
    email: z.string().trim().toLowerCase().email("Enter a valid email").nullable(),
    phone: z.string().trim().max(40).nullable(),
    jobTitle: z.string().trim().max(120).nullable(),
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
