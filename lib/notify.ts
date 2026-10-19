import "server-only";
import { prisma } from "@/lib/prisma";
import { appLink } from "@/lib/env";
import { sendSlackDm, slackEscape } from "@/lib/slack";

/** Every notification of Phase 1 (PRD "Semua notifikasi Fase 1"). */
export const NOTIFICATION_TYPES = {
  task_assigned: "Assigned to a task",
  task_mentioned: "Mentioned in a comment",
  task_comment: "New comment on your task",
  task_due_tomorrow: "Task due tomorrow",
  task_blocked: "Task blocked",
  time_reminder: "Daily time log reminder",
  correction_requested: "New time correction request",
  correction_decided: "Time correction decision",
  oos_digest: "Out-of-scope daily summary",
  oos_decided: "Out-of-scope decision",
  budget_threshold: "Budget threshold passed",
  payment_received: "Payment received",
  payment_unmatched: "Unmatched payment",
  invoice_overdue: "Invoice overdue",
  slack_test: "Slack test message",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** Types a user may switch off in their profile (M0.6). The rest always arrive. */
export const MUTABLE_NOTIFICATION_TYPES: NotificationType[] = [
  "task_assigned",
  "task_mentioned",
  "task_comment",
  "task_due_tomorrow",
  "task_blocked",
  "time_reminder",
  "oos_digest",
  "budget_threshold",
];

export type NotifyPayload = {
  title: string;
  body?: string;
  /** App path the notification links to, e.g. /projects/…?task=… */
  path?: string;
  refId?: string;
};

export type NotifyResult = { delivered: "slack" | "in_app" | "skipped"; error?: string };

/**
 * notify(user_id, type, payload) — sends a Slack DM from the bot when the user
 * is linked to Slack, and always records it in `notification_log`, which is
 * also the in-app inbox (so nothing is lost for users not on Slack yet).
 * Never throws: a failed notification must not fail the action behind it.
 */
export async function notify(userId: string, type: NotificationType, payload: NotifyPayload): Promise<NotifyResult> {
  try {
    const user = await prisma.profile.findUnique({
      where: { id: userId },
      select: { status: true, slackUserId: true, mutedNotifications: true },
    });
    if (!user || user.status === "deactivated") return { delivered: "skipped" };
    if (MUTABLE_NOTIFICATION_TYPES.includes(type) && user.mutedNotifications.includes(type)) {
      return { delivered: "skipped" };
    }

    const url = payload.path ? appLink(payload.path) : undefined;
    let channel: "slack" | "in_app" = "in_app";
    let status = "sent";
    let error: string | undefined;

    if (user.slackUserId) {
      channel = "slack";
      const text = [`*${slackEscape(payload.title)}*`, payload.body ? slackEscape(payload.body) : null, url ? `<${url}|Open in Odama OS>` : null]
        .filter(Boolean)
        .join("\n");
      const res = await sendSlackDm(user.slackUserId, text);
      if (!res.ok) {
        status = "failed";
        error = res.error;
      }
    }

    await prisma.notificationLog.create({
      data: {
        userId,
        channel,
        type,
        refId: payload.refId ?? null,
        title: payload.title,
        body: payload.body ?? null,
        url: payload.path ?? null,
        status,
        error: error ?? null,
      },
    });
    return status === "sent" ? { delivered: channel } : { delivered: channel, error };
  } catch (err) {
    console.error("[notify] failed", type, err);
    return { delivered: "skipped", error: err instanceof Error ? err.message : "error" };
  }
}

/** Same notification to several people, skipping duplicates and `except`. */
export async function notifyMany(
  userIds: (string | null | undefined)[],
  type: NotificationType,
  payload: NotifyPayload,
  except?: string | null,
): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== except))];
  await Promise.all(unique.map((id) => notify(id, type, payload)));
}

/** Was this exact notification already sent to the user since `since`? Keeps jobs idempotent. */
export async function alreadyNotified(userId: string, type: NotificationType, refId: string, since: Date): Promise<boolean> {
  const hit = await prisma.notificationLog.findFirst({
    where: { userId, type, refId, sentAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(hit);
}
