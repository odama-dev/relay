"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { clientPaymentStatus, clientSchema, contactSchema, uuid, type ClientValues } from "@/lib/validation";
import type { Tx } from "@/lib/db";
import { getClientRecord, type ClientRecord } from "@/lib/clients/record";

const FORBIDDEN = "Only PMs, Sales and C-Level manage clients.";

function clientData(d: ClientValues) {
  return {
    code: d.code,
    name: d.name,
    country: d.country ?? null,
    timezone: d.timezone ?? null,
    defaultCurrency: d.defaultCurrency,
    billingEmail: d.billingEmail ?? null,
    billingAddress: d.billingAddress ?? null,
    notes: d.notes ?? null,
  };
}

function revalidateClient(id?: string) {
  revalidatePath("/clients");
  if (id) revalidatePath(`/clients/${id}`);
}

export async function createClient(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.editClients(user)) fail(FORBIDDEN);
    const d = parseOrFail(clientSchema(), raw);
    const client = await asUser(user, (tx) => tx.client.create({ data: { ...clientData(d), createdBy: user.id } }));
    await logActivity({ actorId: user.id, entityType: "client", entityId: client.id, action: "created", metadata: { code: d.code } });
    revalidateClient();
    return { id: client.id };
  });
}

/** The code can't change once the client has projects (clients_guard trigger). */
export async function updateClient(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const clientId = parseOrFail(uuid, id);
    const res = await asUser(user, async (tx) => {
      const current = await tx.client.findUnique({ where: { id: clientId }, select: { code: true } });
      if (!current) fail("Client not found.");
      // Its current code stays valid even if it predates the 3-letter rule.
      const d = parseOrFail(clientSchema(current.code), raw);
      return tx.client.updateMany({ where: { id: clientId }, data: clientData(d) });
    });
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "client", entityId: clientId, action: "updated" });
    revalidateClient(clientId);
  });
}

/**
 * Sets the client's payment status by hand (On track / Due soon / Late), or
 * with null goes back to following its payment requests. Who set it and when
 * are stamped by the clients_guard trigger.
 */
export async function setClientPaymentStatus(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const clientId = parseOrFail(uuid, id);
    const status = parseOrFail(clientPaymentStatus, raw);
    const res = await asUser(user, (tx) => tx.client.updateMany({ where: { id: clientId }, data: { paymentStatusOverride: status } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "client", entityId: clientId, action: "payment_status_set", metadata: { to: status ?? "automatic" } });
    revalidateClient(clientId);
    revalidatePath("/dashboard");
  });
}

/** Archived clients disappear from new-project choices (M1.1). */
export async function setClientArchived(id: unknown, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const clientId = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.client.updateMany({ where: { id: clientId }, data: { isArchived: archived } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "client", entityId: clientId, action: archived ? "archived" : "restored" });
    revalidateClient(clientId);
  });
}

/** Only a client with no projects or invoices can be deleted (FKs restrict). */
export async function deleteClient(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const clientId = parseOrFail(uuid, id);
    const res = await asUser(user, (tx) => tx.client.deleteMany({ where: { id: clientId } }));
    if (res.count === 0) fail(FORBIDDEN);
    await logActivity({ actorId: user.id, entityType: "client", entityId: clientId, action: "deleted" });
    revalidateClient();
  });
}

// --- Contacts: one primary per client ---------------------------------------

async function clearPrimary(tx: Tx, clientId: string, except?: string) {
  await tx.clientContact.updateMany({ where: { clientId, isPrimary: true, ...(except ? { id: { not: except } } : {}) }, data: { isPrimary: false } });
}

export async function saveContact(clientId: unknown, contactId: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const cid = parseOrFail(uuid, clientId);
    const d = parseOrFail(contactSchema, raw);
    await asUser(user, async (tx) => {
      const count = await tx.clientContact.count({ where: { clientId: cid } });
      // The first contact becomes primary.
      const isPrimary = d.isPrimary || count === 0;
      const data = { name: d.name, email: d.email ?? null, title: d.title ?? null };
      if (contactId) {
        const id = parseOrFail(uuid, contactId);
        if (isPrimary) await clearPrimary(tx, cid, id);
        const res = await tx.clientContact.updateMany({ where: { id, clientId: cid }, data: { ...data, ...(isPrimary ? { isPrimary } : {}) } });
        if (res.count === 0) fail(FORBIDDEN);
      } else {
        if (isPrimary) await clearPrimary(tx, cid);
        await tx.clientContact.create({ data: { ...data, clientId: cid, isPrimary } });
      }
    });
    await logActivity({ actorId: user.id, entityType: "client", entityId: cid, action: "contact_saved" });
    revalidateClient(cid);
  });
}

export async function makePrimaryContact(clientId: unknown, contactId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const cid = parseOrFail(uuid, clientId);
    const id = parseOrFail(uuid, contactId);
    await asUser(user, async (tx) => {
      await clearPrimary(tx, cid, id);
      const res = await tx.clientContact.updateMany({ where: { id, clientId: cid }, data: { isPrimary: true } });
      if (res.count === 0) fail(FORBIDDEN);
    });
    revalidateClient(cid);
  });
}

export async function deleteContact(clientId: unknown, contactId: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const cid = parseOrFail(uuid, clientId);
    const id = parseOrFail(uuid, contactId);
    const res = await asUser(user, (tx) => tx.clientContact.deleteMany({ where: { id, clientId: cid } }));
    if (res.count === 0) fail(FORBIDDEN);
    revalidateClient(cid);
  });
}

/** The client side panel's data (`?client=<id>`), read under RLS. */
export async function loadClientRecord(clientId: unknown): Promise<ClientRecord> {
  const user = await requireUser();
  const id = uuid.safeParse(clientId);
  if (!id.success || !perms.viewClients(user)) throw new Error("Client not found");
  const record = await getClientRecord(user, id.data);
  if (!record) throw new Error("Client not found");
  return record;
}
