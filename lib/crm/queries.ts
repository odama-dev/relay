import "server-only";
import type { CrmObject } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { todayIn, type IsoDate } from "@/lib/time/pure";
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
