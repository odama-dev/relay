"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { ownProfileSchema } from "@/lib/validation";
import { MUTABLE_NOTIFICATION_TYPES, type NotificationType } from "@/lib/notify";

/** M0.3 — a user edits their own name, avatar and time zone (+ M0.6 mutes). */
export async function updateOwnProfile(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const data = parseOrFail(ownProfileSchema, raw);
    if (!Intl.supportedValuesOf("timeZone").includes(data.timezone)) fail("Choose a valid time zone.");
    const muted = data.mutedNotifications.filter((t) => MUTABLE_NOTIFICATION_TYPES.includes(t as NotificationType));
    await asUser(user, (tx) =>
      tx.profile.update({
        where: { id: user.id },
        data: { fullName: data.fullName, avatarUrl: data.avatarUrl ?? null, timezone: data.timezone, mutedNotifications: muted },
      }),
    );
    revalidatePath("/", "layout");
  });
}
