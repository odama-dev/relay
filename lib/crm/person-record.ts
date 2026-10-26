import "server-only";
import type { StageCategory } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { numOr0 } from "@/lib/money";
import { isoDate } from "@/lib/time/pure";
import { connectionStrength, type ConnectionStrength } from "@/lib/crm/pure";
import { loadNotes, type NoteView } from "@/lib/crm/queries";
import { crmMail, type MailView } from "@/lib/mail/queries";

export type PersonRecord = {
  id: string;
  company: { id: string; name: string; domain: string | null; clientId: string | null } | null;
  deals: { id: string; title: string; stage: string; category: StageCategory; value: number; currency: string; leadDate: string }[];
  notes: NoteView[];
  mail: MailView[];
  strength: ConnectionStrength;
  viewer: { canWriteNotes: boolean; timeZone: string };
};

/** What the person side panel adds to the People row, read under RLS. */
export async function getPersonRecord(user: CurrentUser, id: string): Promise<PersonRecord | null> {
  const person = await asUser(user, (tx) =>
    tx.crmPerson.findUnique({
      where: { id },
      select: {
        id: true,
        company: { select: { id: true, name: true, domain: true, clientId: true } },
        deals: {
          orderBy: [{ leadDate: "desc" }, { createdAt: "desc" }],
          select: { id: true, title: true, value: true, currency: true, leadDate: true, stage: { select: { name: true, category: true } } },
        },
      },
    }),
  );
  if (!person) return null;
  const [notes, mail] = await Promise.all([loadNotes(user, { personId: person.id }), crmMail(user, { personIds: [person.id] })]);
  return {
    id: person.id,
    company: person.company,
    deals: person.deals.map((d) => ({
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
