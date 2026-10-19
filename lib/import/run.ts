import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIsoDate } from "@/lib/time/pure";
import { createInvitedProfile } from "@/lib/people/accounts";
import { parseCsv, toRecords } from "./csv";
import { IMPORT_COLUMNS, type ImportKind } from "./templates";
import {
  validateClients,
  validateProjects,
  validateUsers,
  type ClientImport,
  type ImportMode,
  type ProjectImport,
  type UserImport,
  type ValidatedRow,
} from "./validate";

/**
 * The import itself (admin only — checked by the action). Runs on the system
 * connection: it is a one-off migration from Notion and spreadsheets, and
 * every row was validated first.
 */

export type ImportRowResult = { line: number; key: string; action: string; errors: string[] };

type Validated = ValidatedRow<unknown>[];

async function validate(kind: ImportKind, text: string, mode: ImportMode): Promise<{ error: string } | { rows: Validated }> {
  const parsed = toRecords(parseCsv(text), IMPORT_COLUMNS[kind]);
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.records.length === 0) return { error: "The file has no rows under the header." };
  if (parsed.records.length > 2000) return { error: "Import at most 2,000 rows at a time." };

  if (kind === "users") {
    const existing = await prisma.profile.findMany({ select: { email: true } });
    return { rows: validateUsers(parsed.records, { existingEmails: new Set(existing.map((p) => p.email)) }, mode) };
  }
  if (kind === "clients") {
    const clients = await prisma.client.findMany({ select: { code: true, name: true, _count: { select: { projects: true } } } });
    return {
      rows: validateClients(
        parsed.records,
        {
          byName: new Map(clients.map((c) => [c.name, { code: c.code, hasProjects: c._count.projects > 0 }])),
          codes: new Map(clients.map((c) => [c.code, c.name])),
        },
        mode,
      ),
    };
  }
  const [clients, people, projects] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true, defaultCurrency: true } }),
    prisma.profile.findMany({ select: { id: true, email: true, role: true, status: true } }),
    prisma.project.findMany({ select: { clientId: true, name: true } }),
  ]);
  return {
    rows: validateProjects(
      parsed.records,
      {
        clients: new Map(clients.map((c) => [c.name, { id: c.id, defaultCurrency: c.defaultCurrency }])),
        people: new Map(people.map((p) => [p.email, { id: p.id, role: p.role, deactivated: p.status === "deactivated" }])),
        existing: new Set(projects.map((p) => `${p.clientId ?? "internal"}:${p.name}`)),
      },
      mode,
    ),
  };
}

const summarize = (rows: Validated): ImportRowResult[] => rows.map(({ line, key, action, errors }) => ({ line, key, action, errors }));

export async function previewImport(kind: ImportKind, text: string, mode: ImportMode) {
  const res = await validate(kind, text, mode);
  return "error" in res ? res : { rows: summarize(res.rows) };
}

/** Imports only the valid rows; each row's outcome comes back for the result CSV. */
export async function executeImport(kind: ImportKind, text: string, mode: ImportMode, actorId: string) {
  const res = await validate(kind, text, mode);
  if ("error" in res) return res;
  const out: ImportRowResult[] = [];

  for (const row of res.rows) {
    const result: ImportRowResult = { line: row.line, key: row.key, action: row.action, errors: row.errors };
    if (row.action === "create" || row.action === "update") {
      try {
        if (kind === "users") await importUser(row as ValidatedRow<UserImport>);
        else if (kind === "clients") await importClient(row as ValidatedRow<ClientImport>, actorId);
        else await importProject(row as ValidatedRow<ProjectImport>, actorId);
        result.action = row.action === "create" ? "created" : "updated";
      } catch (err) {
        result.action = "error";
        result.errors = [err instanceof Error ? err.message.split("\n").pop()! : "Import failed"];
      }
    } else if (row.action === "skip") result.action = "skipped";
    out.push(result);
  }
  return { rows: out };
}

async function importUser(row: ValidatedRow<UserImport>) {
  const d = row.data!;
  if (row.action === "create") {
    // Status `invited`; invitations go out when the admin presses "Send invitations".
    await createInvitedProfile(d);
    return;
  }
  await prisma.profile.update({
    where: { email: d.email },
    data: { fullName: d.fullName, role: d.role, employmentType: d.employmentType, isAdmin: d.isAdmin },
  });
}

async function importClient(row: ValidatedRow<ClientImport>, actorId: string) {
  const { contact, ...d } = row.data!;
  await prisma.$transaction(async (tx) => {
    const client =
      row.action === "create"
        ? await tx.client.create({ data: { ...d, createdBy: actorId } })
        : await tx.client.update({ where: { name: d.name }, data: d });
    if (contact) {
      const existing = await tx.clientContact.findFirst({ where: { clientId: client.id, name: contact.name } });
      await tx.clientContact.updateMany({ where: { clientId: client.id, isPrimary: true }, data: { isPrimary: false } });
      if (existing) await tx.clientContact.update({ where: { id: existing.id }, data: { ...contact, isPrimary: true } });
      else await tx.clientContact.create({ data: { ...contact, clientId: client.id, isPrimary: true } });
    }
  });
}

async function importProject(row: ValidatedRow<ProjectImport>, actorId: string) {
  const d = row.data!;
  const budget = {
    budgetHours: d.budgetHours,
    retainerHoursPerMonth: d.retainerHoursPerMonth,
    rolloverMode: d.rolloverMode,
    rolloverCapHours: d.rolloverCapHours,
  };
  const fields = {
    name: d.name,
    contractType: d.contractType,
    currency: d.currency,
    pmId: d.pmId,
    status: d.status,
    startDate: parseIsoDate(d.startDate),
    endDate: d.endDate ? parseIsoDate(d.endDate) : null,
    links: d.links as Prisma.InputJsonValue,
  };
  await prisma.$transaction(async (tx) => {
    let projectId: string;
    if (row.action === "create") {
      const p = await tx.project.create({ data: { ...fields, kind: d.kind, clientId: d.clientId, createdBy: actorId } });
      projectId = p.id;
      await tx.projectBudget.create({ data: { projectId, ...budget } });
    } else {
      const p = await tx.project.findFirstOrThrow({ where: { clientId: d.clientId, name: d.name } });
      projectId = p.id;
      await tx.project.update({ where: { id: projectId }, data: fields });
      await tx.projectBudget.upsert({ where: { projectId }, create: { projectId, ...budget }, update: budget });
    }
    if (d.kind === "client") {
      await tx.projectContract.upsert({
        where: { projectId },
        create: { projectId, contractValue: d.contractValue },
        update: { contractValue: d.contractValue },
      });
    }
    if (d.memberIds.length) {
      await tx.projectMember.createMany({
        data: d.memberIds.map((userId) => ({ projectId, userId, addedBy: actorId })),
        skipDuplicates: true,
      });
    }
  });
}
