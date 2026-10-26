import "server-only";
import type { CrmObject, Prisma, StageCategory } from "@prisma/client";
import { numOr0 } from "@/lib/money";
import { asUser, type CurrentUser } from "@/lib/auth";
import { isoDate, todayIn, type IsoDate } from "@/lib/time/pure";
import { optionsSchema, type CrmAttributeType, type CrmOption, type CrmValue } from "@/lib/crm/pure";

/** Sales CRM reads (RLS: Sales and Studio Report). Archived records and columns are left out. */

export type CrmColumn = { id: string; name: string; type: CrmAttributeType; options: CrmOption[] };
export type Ref = { id: string; name: string };

export type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  owner: Ref | null;
  client: Ref | null;
  people: number;
  values: Record<string, CrmValue>;
  createdOn: IsoDate;
};

export type PersonRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  company: Ref | null;
  owner: Ref | null;
  values: Record<string, CrmValue>;
  createdOn: IsoDate;
};

async function columns(user: CurrentUser, object: CrmObject): Promise<CrmColumn[]> {
  const rows = await asUser(user, (tx) => tx.crmAttribute.findMany({ where: { object, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }));
  return rows.map((a) => ({ id: a.id, name: a.name, type: a.type, options: optionsSchema.catch([]).parse(a.options) }));
}

const valuesOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, CrmValue>) : {});
const ref = (p: { id: string; fullName: string } | null) => (p ? { id: p.id, name: p.fullName } : null);

export async function loadCompanies(user: CurrentUser) {
  const [cols, rows] = await Promise.all([
    columns(user, "company"),
    asUser(user, (tx) =>
      tx.crmCompany.findMany({
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        include: {
          owner: { select: { id: true, fullName: true } },
          client: { select: { id: true, name: true } },
          _count: { select: { people: { where: { archivedAt: null } } } },
        },
      }),
    ),
  ]);
  return {
    columns: cols,
    rows: rows.map(
      (c): CompanyRow => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        description: c.description,
        owner: ref(c.owner),
        client: c.client,
        people: c._count.people,
        values: valuesOf(c.values),
        createdOn: todayIn(user.timezone, c.createdAt),
      }),
    ),
  };
}

export async function loadPeople(user: CurrentUser) {
  const [cols, rows, companies] = await Promise.all([
    columns(user, "person"),
    asUser(user, (tx) =>
      tx.crmPerson.findMany({
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        include: { owner: { select: { id: true, fullName: true } }, company: { select: { id: true, name: true, archivedAt: true } } },
      }),
    ),
    asUser(user, (tx) => tx.crmCompany.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } })),
  ]);
  return {
    columns: cols,
    companies,
    rows: rows.map(
      (p): PersonRow => ({
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        jobTitle: p.jobTitle,
        company: p.company && !p.company.archivedAt ? { id: p.company.id, name: p.company.name } : null,
        owner: ref(p.owner),
        values: valuesOf(p.values),
        createdOn: todayIn(user.timezone, p.createdAt),
      }),
    ),
  };
}

export type CrmPersonOption = { id: string; name: string; email: string | null; companyId: string | null };
export type CrmCompanyOption = { id: string; name: string; domain: string | null };

/** People and companies to associate a deal with (Sales / Studio Report under RLS). */
export async function crmOptions(user: CurrentUser): Promise<{ people: CrmPersonOption[]; companies: CrmCompanyOption[] }> {
  return asUser(user, async (tx) => ({
    people: await tx.crmPerson.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, companyId: true } }),
    companies: await tx.crmCompany.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, domain: true } }),
  }));
}

// ---------------------------------------------------------------------------
// Notes and the Sales view of a client
// ---------------------------------------------------------------------------

export type NoteView = {
  id: string;
  body: string;
  author: Ref | null;
  createdAt: string;
  edited: boolean;
  mine: boolean;
  /** Where it was written when shown on a wider timeline, e.g. the deal's name. */
  context: string | null;
};

export type NoteTarget = { clientId?: string; companyId?: string; personId?: string; dealId?: string };

const noteInclude = { author: { select: { id: true, fullName: true } }, deal: { select: { title: true } }, person: { select: { name: true } } } as const;

function noteView(user: CurrentUser, n: Prisma.CrmNoteGetPayload<{ include: typeof noteInclude }>, own?: NoteTarget): NoteView {
  const context = n.dealId && n.dealId !== own?.dealId ? (n.deal?.title ?? null) : n.personId && n.personId !== own?.personId ? (n.person?.name ?? null) : null;
  return {
    id: n.id,
    body: n.body,
    author: n.author ? { id: n.author.id, name: n.author.fullName } : null,
    createdAt: n.createdAt.toISOString(),
    edited: n.updatedAt.getTime() - n.createdAt.getTime() > 1000,
    mine: n.authorId === user.id,
    context,
  };
}

export type ClientSalesView = {
  company: { id: string; name: string; domain: string | null } | null;
  /** The deal the header shows: the latest open one, else the latest. */
  current: { id: string; title: string; stage: string; category: StageCategory; owner: Ref | null; value: number; currency: string } | null;
  deals: {
    id: string;
    title: string;
    stage: string;
    category: StageCategory;
    owner: Ref | null;
    person: Ref | null;
    value: number;
    currency: string;
    leadDate: IsoDate;
    lastContactOn: IsoDate | null;
  }[];
  people: { id: string; name: string; email: string | null; jobTitle: string | null }[];
  notes: NoteView[];
};

/**
 * What Sales sees on a client (RLS: Sales and Studio Report): its company,
 * deals (linked to the client or its company), the people at the company or
 * on its deals, and one notes timeline across the client, company and deals.
 */
export async function getClientSales(user: CurrentUser, clientId: string): Promise<ClientSalesView> {
  return asUser(user, async (tx) => {
    const company = await tx.crmCompany.findUnique({
      where: { clientId },
      select: { id: true, name: true, domain: true, people: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, jobTitle: true } } },
    });
    const deals = await tx.deal.findMany({
      where: { OR: [{ clientId }, ...(company ? [{ companyId: company.id }] : [])] },
      include: {
        stage: { select: { name: true, category: true } },
        owner: { select: { id: true, fullName: true } },
        person: { select: { id: true, name: true, email: true, jobTitle: true } },
      },
      orderBy: [{ leadDate: "desc" }, { createdAt: "desc" }],
    });
    const notes = await tx.crmNote.findMany({
      where: { OR: [{ clientId }, ...(company ? [{ companyId: company.id }] : []), ...(deals.length ? [{ dealId: { in: deals.map((d) => d.id) } }] : [])] },
      include: noteInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const rows = deals.map((d) => ({
      id: d.id,
      title: d.title,
      stage: d.stage.name,
      category: d.stage.category,
      owner: d.owner ? { id: d.owner.id, name: d.owner.fullName } : null,
      person: d.person ? { id: d.person.id, name: d.person.name } : null,
      value: numOr0(d.value),
      currency: d.currency,
      leadDate: isoDate(d.leadDate),
      lastContactOn: d.lastContactOn ? isoDate(d.lastContactOn) : null,
    }));
    const current = rows.find((d) => d.category === "open") ?? rows[0] ?? null;
    const people = new Map((company?.people ?? []).map((p) => [p.id, p]));
    for (const d of deals) if (d.person && !people.has(d.person.id)) people.set(d.person.id, d.person);
    return {
      company: company ? { id: company.id, name: company.name, domain: company.domain } : null,
      current: current && { id: current.id, title: current.title, stage: current.stage, category: current.category, owner: current.owner, value: current.value, currency: current.currency },
      deals: rows,
      people: [...people.values()],
      notes: notes.map((n) => noteView(user, n, { clientId })),
    };
  });
}

/** Notes on one record, newest first. */
export async function loadNotes(user: CurrentUser, target: NoteTarget): Promise<NoteView[]> {
  const rows = await asUser(user, (tx) => tx.crmNote.findMany({ where: target, include: noteInclude, orderBy: { createdAt: "desc" }, take: 200 }));
  return rows.map((n) => noteView(user, n, target));
}
