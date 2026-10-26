import "server-only";
import type { StageCategory } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { numOr0 } from "@/lib/money";
import { isoDate } from "@/lib/time/pure";
import { connectionStrength, type ConnectionStrength } from "@/lib/crm/pure";
import { loadNotes, type NoteView } from "@/lib/crm/queries";
import { crmMail, type MailView } from "@/lib/mail/queries";

export type CompanyRecord = {
  id: string;
  people: { id: string; name: string; email: string | null; jobTitle: string | null }[];
  deals: { id: string; title: string; stage: string; category: StageCategory; value: number; currency: string; leadDate: string }[];
  notes: NoteView[];
  mail: MailView[];
  strength: ConnectionStrength;
  viewer: { canWriteNotes: boolean; timeZone: string };
};

/** What the company side panel adds to the Companies row, read under RLS: its team, deals, notes and mail. */
export async function getCompanyRecord(user: CurrentUser, id: string): Promise<CompanyRecord | null> {
  const company = await asUser(user, (tx) =>
    tx.crmCompany.findUnique({
      where: { id },
      select: {
        id: true,
        people: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, jobTitle: true } },
        deals: {
          orderBy: [{ leadDate: "desc" }, { createdAt: "desc" }],
          select: { id: true, title: true, value: true, currency: true, leadDate: true, stage: { select: { name: true, category: true } } },
        },
      },
    }),
  );
  if (!company) return null;
  const [notes, mail] = await Promise.all([loadNotes(user, { companyId: company.id }), crmMail(user, { companyId: company.id, personIds: company.people.map((p) => p.id) })]);
  return {
    id: company.id,
    people: company.people,
    deals: company.deals.map((d) => ({
      id: d.id,
      title: d.title,
      stage: d.stage.name,
      category: d.stage.category,
      value: numOr0(d.value),
      currency: d.currency,
      leadDate: isoDate(d.leadDate),
    })),
    notes,
    mail,
    strength: connectionStrength(mail, new Date()),
    viewer: { canWriteNotes: perms.manageDeals(user), timeZone: user.timezone },
  };
}
