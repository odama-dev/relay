"use server";

import { asUser, requireUser } from "@/lib/auth";
import { getInbox, type Inbox } from "@/lib/notifications/queries";

export async function listInbox(): Promise<Inbox> {
  return getInbox(await requireUser());
}

export async function markInboxRead(): Promise<void> {
  const user = await requireUser();
  await asUser(user, (tx) =>
    tx.notificationLog.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } }),
  );
}
