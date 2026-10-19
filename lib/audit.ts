import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type LogInput = {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: "created" | "updated" | "archived" | "restored" | "deleted" | (string & {});
  metadata?: Prisma.InputJsonValue;
};

/**
 * Single audit-trail entry point. Every mutating server action calls this
 * after the change succeeded. Never throws — auditing must not break the
 * user's action. Written by the system connection: activity_log has no
 * insert policy, so users can't forge entries.
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        metadata: input.metadata,
      },
    });
  } catch (err) {
    console.error("[audit] failed to log activity", err);
  }
}
