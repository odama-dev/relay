"use server";

import { revalidatePath } from "next/cache";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { perms } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { uuid, inviteSchema, personAdminSchema } from "@/lib/validation";
import { createInvitedProfile, linkSlack, sendInvitation, setAccountActive } from "@/lib/people/accounts";

const FORBIDDEN = "Only HR or an admin can manage people.";

/** M0.1 — invite: profile + auth user, then the 7-day link by email. */
export async function invitePerson(raw: unknown): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.managePeople(user)) fail(FORBIDDEN);
    const data = parseOrFail(inviteSchema, raw);
    if (data.isAdmin && !user.isAdmin) fail("Only an admin can grant admin access.");

    const id = await createInvitedProfile(data);
    const sent = await sendInvitation(id, user.id);
    await logActivity({ actorId: user.id, entityType: "profile", entityId: id, action: "invited", metadata: { role: data.role } });
    revalidatePath("/people");
    return { link: sent.link, emailed: sent.emailed };
  });
}

export async function resendInvite(id: unknown): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  return run(async () => {
    const user = await requireUser();
    if (!perms.managePeople(user)) fail(FORBIDDEN);
    const userId = parseOrFail(uuid, id);
    const sent = await sendInvitation(userId, user.id);
    await logActivity({ actorId: user.id, entityType: "profile", entityId: userId, action: "invite_resent" });
    return { link: sent.link, emailed: sent.emailed };
  });
}

/** Role, employment type, admin flag — written under RLS (profiles_guard enforces who). */
export async function updatePerson(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const userId = parseOrFail(uuid, id);
    const data = parseOrFail(personAdminSchema, raw);
    const before = await asUser(user, (tx) => tx.profile.findUnique({ where: { id: userId } }));
    if (!before) fail("This person no longer exists.");
    const updated = await asUser(user, (tx) =>
      tx.profile.updateMany({
        where: { id: userId },
        data: { fullName: data.fullName, role: data.role, employmentType: data.employmentType, isAdmin: data.isAdmin },
      }),
    );
    if (updated.count === 0) fail(FORBIDDEN);
    await logActivity({
      actorId: user.id,
      entityType: "profile",
      entityId: userId,
      action: "updated",
      metadata: { from: { role: before.role, isAdmin: before.isAdmin }, to: { role: data.role, isAdmin: data.isAdmin } },
    });
    revalidatePath("/people");
  });
}

/** M0.4 — deactivate / reactivate. History stays; sessions end at once. */
export async function setPersonActive(id: unknown, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const userId = parseOrFail(uuid, id);
    if (userId === user.id) fail("You can't deactivate yourself.");
    const target = await prisma.profile.findUnique({ where: { id: userId }, select: { status: true } });
    if (!target) fail("This person no longer exists.");
    if (active && target.status !== "deactivated") return;

    const res = await asUser(user, (tx) =>
      tx.profile.updateMany({
        where: { id: userId },
        data: active
          ? // An invited user who never joined goes back to invited.
            { status: target.status === "deactivated" ? "active" : target.status, deactivatedAt: null }
          : { status: "deactivated", deactivatedAt: new Date() },
      }),
    );
    if (res.count === 0) fail(FORBIDDEN);
    await setAccountActive(userId, active);
    await logActivity({ actorId: user.id, entityType: "profile", entityId: userId, action: active ? "reactivated" : "deactivated" });
    revalidatePath("/people");
  });
}

/** M0.6 — admin retries the Slack email lookup. */
export async function retrySlackLink(id: unknown): Promise<ActionResult<{ linked: boolean }>> {
  return run(async () => {
    const user = await requireUser();
    if (!user.isAdmin) fail("Only an admin can manage Slack.");
    const res = await linkSlack(parseOrFail(uuid, id));
    if (!res.linked) {
      fail(
        res.error === "slack_not_configured"
          ? "Slack isn't configured (SLACK_BOT_TOKEN)."
          : res.error === "users_not_found"
            ? "No Slack account uses this email."
            : `Slack: ${res.error ?? "lookup failed"}`,
      );
    }
    revalidatePath("/people");
    revalidatePath("/settings");
    return { linked: true };
  });
}
