import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { EmploymentType, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appLink, supabaseAdminConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmail, sendMail } from "@/lib/mail";
import { lookupSlackUserId } from "@/lib/slack";
import { ActionError } from "@/lib/actions";

/**
 * Account lifecycle (M0.1, M0.2, M0.4) — the system half. Callers check the
 * actor's permission first (people/actions.ts); these functions use the
 * system connection and the Supabase admin API.
 */

export const INVITE_TTL_DAYS = 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Creates the Supabase auth user (no password yet) and the `invited` profile
 * with the same id. Throws if the email is already registered (M0.1).
 */
export async function createInvitedProfile(input: {
  fullName: string;
  email: string;
  role: UserRole;
  employmentType: EmploymentType;
  isAdmin: boolean;
}): Promise<string> {
  const existing = await prisma.profile.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new AccountError("This email is already registered.");

  let id: string = randomUUID();
  if (supabaseAdminConfigured) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (error || !data.user) {
      throw new AccountError(
        /already been registered|already exists/i.test(error?.message ?? "")
          ? "This email is already registered."
          : (error?.message ?? "Couldn't create the account."),
      );
    }
    id = data.user.id;
  }

  await prisma.profile.create({
    data: {
      id,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      employmentType: input.employmentType,
      isAdmin: input.isAdmin,
      status: "invited",
    },
  });
  return id;
}

/**
 * Issues a fresh 7-day invitation link (revoking earlier ones) and emails it
 * through Resend. Returns the link so admins can copy it when email isn't
 * configured locally.
 */
export async function sendInvitation(userId: string, sentBy: string | null): Promise<{ link: string; emailed: boolean; error?: string }> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: userId } });
  if (profile.status !== "invited") throw new AccountError("This person has already joined.");

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.userInvitation.updateMany({
      where: { userId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.userInvitation.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        sentBy,
      },
    }),
  ]);

  const link = appLink(`/invite/${token}`);
  const { html, text } = renderEmail({
    heading: "You're invited to Odama OS",
    paragraphs: [
      `Hi ${profile.fullName},`,
      "You've been invited to Odama OS, the studio's workspace for projects, tasks, time and invoices.",
      `Create your password to get started. This link is valid for ${INVITE_TTL_DAYS} days.`,
    ],
    action: { label: "Create password", url: link },
    footer: "If you weren't expecting this, you can ignore this email.",
  });
  const res = await sendMail({ to: [profile.email], subject: "Your Odama OS invitation", html, text });
  return { link, emailed: res.ok, error: res.ok ? undefined : res.error };
}

export type InvitationCheck =
  | { ok: true; invitationId: string; userId: string; email: string; fullName: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

export async function checkInvitation(token: string): Promise<InvitationCheck> {
  const inv = await prisma.userInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { email: true, fullName: true, status: true } } },
  });
  if (!inv || inv.revokedAt) return { ok: false, reason: "invalid" };
  if (inv.acceptedAt || inv.user.status !== "invited") return { ok: false, reason: "used" };
  if (inv.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return { ok: true, invitationId: inv.id, userId: inv.userId, email: inv.user.email, fullName: inv.user.fullName };
}

/** Sets the password, activates the profile and maps Slack (M0.1, M0.6). */
export async function acceptInvitation(token: string, password: string): Promise<{ email: string }> {
  const check = await checkInvitation(token);
  if (!check.ok) {
    throw new AccountError(
      check.reason === "expired"
        ? "This invitation has expired. Ask HR or an admin to send a new one."
        : "This invitation link is no longer valid.",
    );
  }

  if (supabaseAdminConfigured) {
    const { error } = await createAdminClient().auth.admin.updateUserById(check.userId, {
      password,
      email_confirm: true,
    });
    if (error) throw new AccountError(error.message);
  }

  await prisma.$transaction([
    prisma.userInvitation.update({ where: { id: check.invitationId }, data: { acceptedAt: new Date() } }),
    prisma.profile.update({ where: { id: check.userId }, data: { status: "active" } }),
  ]);
  await linkSlack(check.userId);
  return { email: check.email };
}

/** "Forgot password" (M0.2): a recovery link through Resend. Silent for unknown emails. */
export async function sendPasswordReset(email: string): Promise<void> {
  const profile = await prisma.profile.findUnique({ where: { email } });
  if (!profile || profile.status !== "active" || !supabaseAdminConfigured) return;

  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) {
    console.error("[auth] recovery link failed", error);
    return;
  }
  const link = appLink(`/auth/callback?token_hash=${hashed}&type=recovery&next=/set-password`);
  const { html, text } = renderEmail({
    heading: "Reset your password",
    paragraphs: [`Hi ${profile.fullName},`, "Use the button below to choose a new password for Odama OS. The link works once and expires in an hour."],
    action: { label: "Choose a new password", url: link },
    footer: "If you didn't ask for this, you can ignore this email — your password won't change.",
  });
  const res = await sendMail({ to: [email], subject: "Reset your Odama OS password", html, text });
  if (!res.ok) console.error("[auth] reset email failed", res.error);
}

/**
 * Deactivate (M0.4): the profile stops resolving on the very next request
 * (lib/auth.ts), and the Supabase user is banned so no session can refresh.
 * Data and history stay. Reactivation reverses both.
 */
export async function setAccountActive(userId: string, active: boolean): Promise<void> {
  if (supabaseAdminConfigured) {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : "876000h",
    });
    if (error && !/not found/i.test(error.message)) throw new AccountError(error.message);
  }
}

/** Finds the Slack user by email and stores the id (M0.6). */
export async function linkSlack(userId: string): Promise<{ linked: boolean; error?: string }> {
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { email: true } });
  if (!profile) return { linked: false, error: "not_found" };
  const { id, error } = await lookupSlackUserId(profile.email);
  if (!id) return { linked: false, error };
  await prisma.profile.update({ where: { id: userId }, data: { slackUserId: id } });
  return { linked: true };
}

/** Shown to the user as-is by `run()` (lib/actions.ts). */
export class AccountError extends ActionError {}
