import "server-only";
import type { MailDirection, Prisma } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";

/** Mail reads under RLS: your own mailboxes; messages you own or that Sales shares on CRM records. */

/** Everything but the encrypted password, which RLS never lets anyone read. */
const accountColumns = {
  id: true,
  email: true,
  displayName: true,
  imapHost: true,
  imapPort: true,
  imapSecure: true,
  smtpHost: true,
  smtpPort: true,
  smtpSecure: true,
  username: true,
  shared: true,
  isActive: true,
  lastError: true,
  lastSyncedAt: true,
} as const satisfies Prisma.MailAccountSelect;

export type Mailbox = Prisma.MailAccountGetPayload<{
  select: typeof accountColumns;
}>;

export async function myMailboxes(user: CurrentUser): Promise<Mailbox[]> {
  return asUser(user, (tx) =>
    tx.mailAccount.findMany({
      where: { userId: user.id },
      select: accountColumns,
      orderBy: { createdAt: "asc" },
    }),
  );
}

export type MailView = {
  id: string;
  messageId: string;
  direction: MailDirection;
  /** Your mailbox it went through; null when it's a teammate's (shared). */
  account: string | null;
  mine: boolean;
  from: { email: string; name: string | null };
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  body: string | null;
  sentAt: string;
  person: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
};

// No `account` include: RLS hides other people's mailboxes, and a shared
// message's account would come back empty.
const messageInclude = {
  person: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
} as const;

function view(own: Map<string, string>, m: Prisma.MailMessageGetPayload<{ include: typeof messageInclude }>): MailView {
  return {
    id: m.id,
    messageId: m.messageId,
    direction: m.direction,
    account: own.get(m.accountId) ?? null,
    mine: own.has(m.accountId),
    from: { email: m.fromEmail, name: m.fromName },
    to: m.toEmails,
    cc: m.ccEmails,
    subject: m.subject,
    snippet: m.snippet,
    body: m.bodyText,
    sentAt: m.sentAt.toISOString(),
    person: m.person,
    company: m.company,
  };
}

export type MailFilters = {
  accountId?: string;
  direction?: MailDirection;
  q?: string;
};

/** Your mail activity: sent and received across your mailboxes, newest first. */
export async function myMailActivity(user: CurrentUser, f: MailFilters, take = 150): Promise<MailView[]> {
  const rows = await asUser(user, (tx) =>
    tx.mailMessage.findMany({
      where: {
        account: { userId: user.id },
        ...(f.accountId ? { accountId: f.accountId } : {}),
        ...(f.direction ? { direction: f.direction } : {}),
        ...(f.q
          ? {
              OR: [
                { subject: { contains: f.q, mode: "insensitive" } },
                { snippet: { contains: f.q, mode: "insensitive" } },
                { fromEmail: { contains: f.q, mode: "insensitive" } },
                { fromName: { contains: f.q, mode: "insensitive" } },
                { toEmails: { has: f.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      include: messageInclude,
      orderBy: { sentAt: "desc" },
      take,
    }),
  );
  const own = await ownAccounts(user);
  return rows.map((m) => view(own, m));
}

/** Your mailboxes, id → address. */
async function ownAccounts(user: CurrentUser): Promise<Map<string, string>> {
  const rows = await asUser(user, (tx) =>
    tx.mailAccount.findMany({
      where: { userId: user.id },
      select: { id: true, email: true },
    }),
  );
  return new Map(rows.map((a) => [a.id, a.email]));
}

/** Mail on a CRM company or its people (client page, Sales view). */
export async function crmMail(user: CurrentUser, target: { companyId?: string | null; personIds?: string[] }, take = 100): Promise<MailView[]> {
  const or: Prisma.MailMessageWhereInput[] = [
    ...(target.companyId ? [{ companyId: target.companyId }] : []),
    ...(target.personIds?.length ? [{ personId: { in: target.personIds } }] : []),
  ];
  if (or.length === 0) return [];
  const [rows, own] = await Promise.all([
    asUser(user, (tx) =>
      tx.mailMessage.findMany({
        where: { OR: or },
        include: messageInclude,
        orderBy: { sentAt: "desc" },
        take,
      }),
    ),
    ownAccounts(user),
  ]);
  return rows.map((m) => view(own, m));
}
