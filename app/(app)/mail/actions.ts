"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { asUser, requireUser, type CurrentUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { encryptSecret } from "@/lib/mail/crypto";
import { sendFromAccount, syncAccount, testConnection } from "@/lib/mail/client";
import { composeMailSchema, mailAccountEditSchema, mailAccountSchema, uuid } from "@/lib/validation";

/**
 * Mail — connect your own mailboxes and send from them. Account rows are
 * written under RLS (only the owner); syncing and sending run on the system
 * side once ownership was proven under RLS.
 */

function revalidateMail() {
  revalidatePath("/mail");
  revalidatePath("/clients", "layout");
}

/** Under RLS: the mailbox is the signed-in user's (others' rows aren't visible). */
async function ownMailbox(user: CurrentUser, id: string) {
  const account = await asUser(user, (tx) =>
    tx.mailAccount.findUnique({
      where: { id },
      select: {
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
        isActive: true,
      },
    }),
  );
  if (!account) fail("Mailbox not found.");
  return account;
}

export async function connectMailbox(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(mailAccountSchema, raw);
    const test = await testConnection(d);
    if (!test.ok) fail(test.error);
    const account = await asUser(user, async (tx) => {
      if (
        await tx.mailAccount.findFirst({
          where: { userId: user.id, email: d.email },
          select: { id: true },
        })
      )
        fail(`${d.email} is already connected.`);
      return tx.mailAccount.create({
        data: {
          userId: user.id,
          email: d.email,
          displayName: d.displayName ?? null,
          imapHost: d.imapHost,
          imapPort: d.imapPort,
          imapSecure: d.imapSecure,
          smtpHost: d.smtpHost,
          smtpPort: d.smtpPort,
          smtpSecure: d.smtpSecure,
          username: d.username,
          passwordEnc: encryptSecret(d.password),
          shared: d.shared,
        },
        select: { id: true },
      });
    });
    await logActivity({
      actorId: user.id,
      entityType: "mail_account",
      entityId: account.id,
      action: "connected",
      metadata: { email: d.email },
    });
    // The first sync (last 30 days) runs after the response.
    after(() =>
      syncAccount(account.id).then(
        () => revalidateMail(),
        () => undefined,
      ),
    );
    revalidateMail();
    return { id: account.id };
  });
}

export async function updateMailbox(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const accountId = parseOrFail(uuid, id);
    const d = parseOrFail(mailAccountEditSchema, raw);
    const account = await ownMailbox(user, accountId);
    if (d.password) {
      const test = await testConnection({ ...account, password: d.password });
      if (!test.ok) fail(test.error);
    }
    const res = await asUser(user, (tx) =>
      tx.mailAccount.updateMany({
        where: { id: accountId },
        data: {
          displayName: d.displayName ?? null,
          shared: d.shared,
          isActive: d.isActive,
          ...(d.password ? { passwordEnc: encryptSecret(d.password), lastError: null } : {}),
        },
      }),
    );
    if (res.count === 0) fail("Mailbox not found.");
    await logActivity({
      actorId: user.id,
      entityType: "mail_account",
      entityId: accountId,
      action: "updated",
      metadata: {
        shared: d.shared,
        isActive: d.isActive,
        password: Boolean(d.password),
      },
    });
    revalidateMail();
  });
}

/** Disconnect: the mailbox and the mail synced from it leave the OS (nothing changes on the mail server). */
export async function disconnectMailbox(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const accountId = parseOrFail(uuid, id);
    const account = await ownMailbox(user, accountId);
    const res = await asUser(user, (tx) => tx.mailAccount.deleteMany({ where: { id: accountId } }));
    if (res.count === 0) fail("Mailbox not found.");
    await logActivity({
      actorId: user.id,
      entityType: "mail_account",
      entityId: accountId,
      action: "disconnected",
      metadata: { email: account.email },
    });
    revalidateMail();
  });
}

/** Sync now — one mailbox, or all of yours. */
export async function syncMailboxes(id?: unknown): Promise<ActionResult<{ added: number; failed: string[] }>> {
  return run(async () => {
    const user = await requireUser();
    const ids = id
      ? [(await ownMailbox(user, parseOrFail(uuid, id))).id]
      : (
          await asUser(user, (tx) =>
            tx.mailAccount.findMany({
              where: { userId: user.id, isActive: true },
              select: { id: true },
            }),
          )
        ).map((a) => a.id);
    let added = 0;
    const failed: string[] = [];
    for (const accountId of ids) {
      try {
        added += (await syncAccount(accountId)).added;
      } catch (err) {
        failed.push(err instanceof Error ? err.message : String(err));
      }
    }
    revalidateMail();
    return { added, failed };
  });
}

export async function sendMailFrom(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUser();
    const d = parseOrFail(composeMailSchema, raw);
    const account = await ownMailbox(user, d.accountId);
    if (!account.isActive) fail("This mailbox is paused. Turn it back on to send from it.");
    let sent: { id: string };
    try {
      sent = await sendFromAccount(account.id, {
        to: d.to,
        cc: d.cc,
        subject: d.subject,
        text: d.text,
        inReplyTo: d.inReplyTo ?? null,
      });
    } catch (err) {
      fail(`Couldn't send: ${err instanceof Error ? err.message : String(err)}`);
    }
    await logActivity({
      actorId: user.id,
      entityType: "mail_message",
      entityId: sent.id,
      action: "sent",
      metadata: { from: account.email, to: d.to, subject: d.subject },
    });
    revalidateMail();
    return sent;
  });
}
