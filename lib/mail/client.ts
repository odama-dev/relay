import "server-only";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import type { MailDirection, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/mail/crypto";
import { domainOf, linkToCrm, nextWindow, normalizeEmail, snippetOf, type FolderState } from "@/lib/mail/pure";

/**
 * IMAP + SMTP for the mailboxes people connect (Mail). System side only: the
 * callers proved the user may act on the account under RLS, or run as the
 * sync job. Passwords are decrypted here and never leave the server.
 */

export type MailServer = {
  email: string;
  displayName?: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
};

/** First sync looks back this far; each run takes at most this many messages per folder. */
const FIRST_SYNC_DAYS = 30;
const MAX_PER_RUN = 200;
/** Enough of the source for headers and the text body of almost any email. */
const SOURCE_BYTES = 256_000;
const BODY_CHARS = 20_000;

const imap = (s: MailServer) =>
  new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    secure: s.imapSecure,
    auth: { user: s.username, pass: s.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });

const smtp = (s: MailServer) =>
  nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: { user: s.username, pass: s.password },
    connectionTimeout: 15_000,
  });

/** Signs in to both servers; the error says which one refused. */
export async function testConnection(s: MailServer): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = imap(s);
  try {
    await client.connect();
    await client.logout();
  } catch (err) {
    return {
      ok: false,
      error: `IMAP sign-in failed (${s.imapHost}:${s.imapPort}): ${message(err)}`,
    };
  }
  try {
    await smtp(s).verify();
  } catch (err) {
    return {
      ok: false,
      error: `SMTP sign-in failed (${s.smtpHost}:${s.smtpPort}): ${message(err)}`,
    };
  }
  return { ok: true };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

type Account = Prisma.MailAccountGetPayload<object>;

function serverOf(a: Account): MailServer {
  return { ...a, password: decryptSecret(a.passwordEnc) };
}

async function crmIndex() {
  const [people, companies] = await Promise.all([
    prisma.crmPerson.findMany({
      where: { archivedAt: null, email: { not: null } },
      select: { id: true, emails: true, companyId: true },
    }),
    prisma.crmCompany.findMany({
      where: { archivedAt: null, domain: { not: null } },
      select: { id: true, domains: true },
    }),
  ]);
  // Every address and domain a record has matches it, primary first.
  return {
    people: people.flatMap((p) => p.emails.map((email) => ({ id: p.id, email, companyId: p.companyId }))),
    companies: companies.flatMap((c) => c.domains.map((domain) => ({ id: c.id, domain }))),
  };
}

/**
 * Pulls new mail from the inbox and the sent folder into mail_messages,
 * linked to CRM people / companies. Idempotent: a message already stored
 * (same Message-ID) is skipped, and the last UID per folder is remembered.
 */
export async function syncAccount(accountId: string): Promise<{ added: number }> {
  const account = await prisma.mailAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  if (!account.isActive) return { added: 0 };
  const crm = await crmIndex();
  const state = (account.syncState ?? {}) as Record<string, FolderState>;
  const client = imap(serverOf(account));
  let added = 0;
  try {
    await client.connect();
    const folders = await client.list();
    const sent = folders.find((f) => f.specialUse === "\\Sent") ?? folders.find((f) => /^(sent|sent items|sent mail)$/i.test(f.name));
    const targets: { key: string; path: string; direction: MailDirection }[] = [
      { key: "inbox", path: "INBOX", direction: "inbound" },
      ...(sent ? [{ key: "sent", path: sent.path, direction: "outbound" as const }] : []),
    ];
    for (const t of targets) {
      const lock = await client.getMailboxLock(t.path);
      try {
        const box = client.mailbox;
        if (!box) continue;
        const validity = String(box.uidValidity);
        const window = nextWindow(state[t.key], validity);
        let uids: number[];
        if ("since" in window) {
          uids = (await client.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000) }, { uid: true })) || [];
        } else {
          uids = (await client.search({ uid: `${window.from}:*` }, { uid: true })) || [];
          // "n:*" always returns the newest message, even one already seen.
          uids = uids.filter((u) => u >= window.from);
        }
        uids.sort((a, b) => a - b);
        // First sync: the newest of the window, then carry on from the folder's end.
        // Catching up: the oldest new ones first, the rest on the next run.
        uids = "since" in window ? uids.slice(-MAX_PER_RUN) : uids.slice(0, MAX_PER_RUN);
        let last = "since" in window ? Math.max(0, (box.uidNext ?? 1) - 1) : window.from - 1;
        if (uids.length) {
          const rows: Prisma.MailMessageCreateManyInput[] = [];
          for await (const msg of client.fetch(
            uids,
            {
              uid: true,
              envelope: true,
              internalDate: true,
              source: { maxLength: SOURCE_BYTES },
            },
            { uid: true },
          )) {
            const row = await toRow(account, msg, t.direction, crm);
            if (row) rows.push(row);
            last = Math.max(last, msg.uid);
          }
          if (rows.length)
            added += (
              await prisma.mailMessage.createMany({
                data: rows,
                skipDuplicates: true,
              })
            ).count;
        }
        state[t.key] = { uid: last, validity };
      } finally {
        lock.release();
      }
    }
    await client.logout();
    await prisma.mailAccount.update({
      where: { id: accountId },
      data: { syncState: state, lastSyncedAt: new Date(), lastError: null },
    });
    if (added) await advanceDeals(accountId);
  } catch (err) {
    await prisma.mailAccount.update({
      where: { id: accountId },
      data: { lastError: message(err) },
    });
    client.close();
    throw err;
  }
  return { added };
}

async function toRow(
  account: Account,
  msg: FetchMessageObject,
  direction: MailDirection,
  crm: Awaited<ReturnType<typeof crmIndex>>,
): Promise<Prisma.MailMessageCreateManyInput | null> {
  const env = msg.envelope;
  const messageId = env?.messageId ?? `<uid-${msg.uid}@${account.imapHost}>`;
  const from = env?.from?.[0];
  const to = (env?.to ?? [])
    .map((a) => a.address)
    .filter((a): a is string => Boolean(a))
    .map(normalizeEmail);
  const cc = (env?.cc ?? [])
    .map((a) => a.address)
    .filter((a): a is string => Boolean(a))
    .map(normalizeEmail);
  let text: string | null = null;
  if (msg.source) {
    try {
      const parsed = await simpleParser(msg.source, {
        skipHtmlToText: false,
        skipImageLinks: true,
      });
      text = (parsed.text ?? "").slice(0, BODY_CHARS) || null;
    } catch {
      text = null;
    }
  }
  const counterparts = direction === "inbound" ? (from?.address ? [from.address] : []) : [...to, ...cc];
  const link = linkToCrm(counterparts, domainOf(account.email), crm.people, crm.companies);
  return {
    accountId: account.id,
    messageId,
    direction,
    fromEmail: normalizeEmail(from?.address ?? account.email),
    fromName: from?.name || null,
    toEmails: to,
    ccEmails: cc,
    subject: (env?.subject ?? "").slice(0, 500),
    snippet: snippetOf(text),
    bodyText: text,
    sentAt: env?.date ?? (msg.internalDate ? new Date(msg.internalDate) : new Date()),
    ...link,
  };
}

/**
 * Sends from a connected mailbox over its SMTP server, files a copy in its
 * Sent folder (best effort — many servers do it themselves) and records it.
 */
export async function sendFromAccount(
  accountId: string,
  mail: {
    to: string[];
    cc: string[];
    subject: string;
    text: string;
    inReplyTo?: string | null;
  },
): Promise<{ id: string }> {
  const account = await prisma.mailAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  const server = serverOf(account);
  const from = account.displayName ? { name: account.displayName, address: account.email } : account.email;
  // Build the raw message once: the same bytes go out over SMTP and into Sent.
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
    from,
    to: mail.to,
    cc: mail.cc.length ? mail.cc : undefined,
    subject: mail.subject,
    text: mail.text,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.inReplyTo } : {}),
  });
  const raw = built.message as Buffer;
  await smtp(server).sendMail({
    envelope: { from: account.email, to: [...mail.to, ...mail.cc] },
    raw,
  });

  const client = imap(server);
  try {
    await client.connect();
    const sent = (await client.list()).find((f) => f.specialUse === "\\Sent");
    if (sent) await client.append(sent.path, raw, ["\\Seen"]);
    await client.logout();
  } catch {
    client.close();
  }

  const crm = await crmIndex();
  const link = linkToCrm([...mail.to, ...mail.cc], domainOf(account.email), crm.people, crm.companies);
  const row = await prisma.mailMessage.upsert({
    where: { accountId_messageId: { accountId, messageId: built.messageId } },
    update: {},
    create: {
      accountId,
      messageId: built.messageId,
      direction: "outbound",
      fromEmail: account.email,
      fromName: account.displayName,
      toEmails: mail.to.map(normalizeEmail),
      ccEmails: mail.cc.map(normalizeEmail),
      subject: mail.subject,
      snippet: snippetOf(mail.text),
      bodyText: mail.text.slice(0, BODY_CHARS),
      sentAt: new Date(),
      ...link,
    },
    select: { id: true },
  });
  await advanceDeals(accountId);
  return row;
}

/**
 * Deals move from email (trigger-side rule, `app.mail_advance_deals`): sent
 * to their person / company → Contacted, an answer → Replied, and the last
 * contact date follows. Never fails the sync or the send.
 */
async function advanceDeals(accountId: string) {
  try {
    await prisma.$queryRaw`SELECT app.mail_advance_deals(${accountId}::uuid)`;
  } catch (err) {
    console.error("mail_advance_deals failed", err);
  }
}

/** Sync job: every active mailbox, one at a time; a failing one is noted on the account and skipped. */
export async function syncAllMailboxes(): Promise<{
  accounts: number;
  added: number;
  failed: number;
}> {
  const accounts = await prisma.mailAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  let added = 0;
  let failed = 0;
  for (const a of accounts) {
    try {
      added += (await syncAccount(a.id)).added;
    } catch {
      failed++;
    }
  }
  return { accounts: accounts.length, added, failed };
}

/** A mailbox not synced for this long syncs again when its owner opens Mail. */
const STALE_MS = 10 * 60_000;

/** After the Mail page is served: sync the viewer's mailboxes that are behind. */
export async function syncStale(mailboxes: { id: string; isActive: boolean; lastSyncedAt: Date | null }[]): Promise<void> {
  const now = Date.now();
  const stale = mailboxes.filter((m) => m.isActive && (!m.lastSyncedAt || now - m.lastSyncedAt.getTime() > STALE_MS));
  await Promise.allSettled(stale.map((m) => syncAccount(m.id)));
}
