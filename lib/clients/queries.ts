import "server-only";
import type { Prisma } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { numOr0 } from "@/lib/money";
import { isoDate } from "@/lib/time/pure";

export type ClientRow = {
  id: string;
  code: string;
  name: string;
  country: string | null;
  defaultCurrency: string;
  isArchived: boolean;
  primaryContact: string | null;
  activeProjects: number;
  totalProjects: number;
};

export async function listClients(user: CurrentUser, f: { q?: string; archived: boolean }): Promise<ClientRow[]> {
  const where: Prisma.ClientWhereInput = {
    isArchived: f.archived,
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { code: { contains: f.q, mode: "insensitive" } },
            { contacts: { some: { name: { contains: f.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const rows = await asUser(user, (tx) =>
    tx.client.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        contacts: { where: { isPrimary: true }, select: { name: true } },
        projects: { select: { status: true } },
      },
    }),
  );
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    country: c.country,
    defaultCurrency: c.defaultCurrency,
    isArchived: c.isArchived,
    primaryContact: c.contacts[0]?.name ?? null,
    activeProjects: c.projects.filter((p) => p.status === "active" || p.status === "on_hold").length,
    totalProjects: c.projects.length,
  }));
}

/** One client with its contacts, projects and invoices — each list filtered by RLS (M1.1). */
export async function getClient(user: CurrentUser, id: string) {
  const c = await asUser(user, (tx) =>
    tx.client.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
        projects: {
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, status: true, contractType: true, pm: { select: { fullName: true } } },
        },
        invoices: {
          orderBy: { issueDate: "desc" },
          select: { id: true, number: true, status: true, currency: true, total: true, amountPaid: true, issueDate: true, project: { select: { code: true } } },
        },
        _count: { select: { projects: true, invoices: true } },
      },
    }),
  );
  if (!c) return null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    country: c.country,
    timezone: c.timezone,
    defaultCurrency: c.defaultCurrency,
    billingEmail: c.billingEmail,
    billingAddress: c.billingAddress,
    notes: c.notes,
    isArchived: c.isArchived,
    // Counted under RLS too, but projects/invoices FKs are what actually block deletes.
    hasHistory: c._count.projects > 0 || c._count.invoices > 0,
    codeLocked: c._count.projects > 0,
    contacts: c.contacts.map((ct) => ({ id: ct.id, name: ct.name, email: ct.email, title: ct.title, isPrimary: ct.isPrimary })),
    projects: c.projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status, contractType: p.contractType, pm: p.pm.fullName })),
    invoices: c.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      currency: i.currency,
      total: numOr0(i.total),
      amountPaid: numOr0(i.amountPaid),
      issueDate: isoDate(i.issueDate),
      projectCode: i.project.code,
    })),
  };
}

export type ClientDetail = NonNullable<Awaited<ReturnType<typeof getClient>>>;
