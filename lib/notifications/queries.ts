import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";

export type InboxItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  sentAt: Date;
  unread: boolean;
};

export type Inbox = { items: InboxItem[]; unreadCount: number };

/** The signed-in user's notifications (notification_log, own rows by RLS). */
export async function getInbox(user: CurrentUser): Promise<Inbox> {
  return asUser(user, async (tx) => {
    const [rows, unreadCount] = await Promise.all([
      tx.notificationLog.findMany({
        where: { userId: user.id, status: { not: "skipped" } },
        orderBy: { sentAt: "desc" },
        take: 40,
        select: { id: true, type: true, title: true, body: true, url: true, sentAt: true, readAt: true },
      }),
      tx.notificationLog.count({ where: { userId: user.id, readAt: null, status: { not: "skipped" } } }),
    ]);
    return {
      items: rows.map(({ readAt, ...r }) => ({ ...r, unread: readAt === null })),
      unreadCount,
    };
  });
}
