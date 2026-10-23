import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppModule, Profile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls, type Tx } from "@/lib/db";
import type { Viewer } from "@/lib/roles";
import { adminEmails, devAuthBypass, devAuthEmail, supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { nameFromEmail } from "@/lib/people/names";

export type CurrentUser = Viewer & {
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
};

type ProfileWithModules = Profile & { modules: { module: AppModule }[] };

const withModules = { modules: { select: { module: true } } } as const;

function toCurrentUser(p: ProfileWithModules): CurrentUser {
  return {
    id: p.id,
    email: p.email,
    fullName: p.fullName,
    role: p.role,
    isAdmin: p.isAdmin,
    accessLevel: p.accessLevel,
    modules: p.modules.map((m) => m.module),
    avatarUrl: p.avatarUrl,
    timezone: p.timezone,
  };
}

/**
 * Bootstrap admin: an ADMIN_EMAILS address that signs in with no profile yet
 * becomes an active C-Level admin. Everyone else must be invited (M0.1).
 */
async function bootstrapAdmin(id: string, email: string): Promise<ProfileWithModules | null> {
  if (!adminEmails.includes(email)) return null;
  return prisma.profile.upsert({
    include: withModules,
    where: { id },
    create: {
      id,
      email,
      fullName: nameFromEmail(email),
      role: "c_level",
      isAdmin: true,
      status: "active",
    },
    update: {},
  });
}

/** Signed-in identity → active profile. Invited and deactivated users get null. */
async function resolve(authUserId: string, email: string): Promise<CurrentUser | null> {
  const normalized = email.toLowerCase();
  let profile = await prisma.profile.findUnique({ where: { id: authUserId }, include: withModules });
  profile ??= await bootstrapAdmin(authUserId, normalized);
  if (!profile || profile.status !== "active") return null;
  return toCurrentUser(profile);
}

async function resolveDev(): Promise<CurrentUser | null> {
  let profile = await prisma.profile.findUnique({ where: { email: devAuthEmail }, include: withModules });
  profile ??= await prisma.profile.create({
    include: withModules,
    data: {
      id: randomUUID(),
      email: devAuthEmail,
      fullName: nameFromEmail(devAuthEmail),
      role: "c_level",
      isAdmin: true,
      status: "active",
    },
  });
  return profile.status === "active" ? toCurrentUser(profile) : null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (devAuthBypass) return resolveDev();
  if (!supabaseConfigured) return null;

  // The proxy (lib/supabase/proxy.ts) already revalidated the session with
  // Supabase Auth and forwards the identity — no second round trip.
  const requestHeaders = await headers();
  const forwardedId = requestHeaders.get("x-app-user-id");
  const forwardedEmail = requestHeaders.get("x-app-user-email");
  if (forwardedId && forwardedEmail) return resolve(forwardedId, forwardedEmail);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return resolve(user.id, user.email);
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // A Supabase session without an active profile (deactivated, never
  // invited): /auth/signout clears it so /login doesn't bounce back here.
  if (!user) redirect(supabaseConfigured ? "/auth/signout" : "/login");
  return user;
}

/** Page guard: bounces users the predicate rejects to their home screen. */
export async function requireAccess(check: (user: CurrentUser) => boolean): Promise<CurrentUser> {
  const user = await requireUser();
  if (!check(user)) redirect("/");
  return user;
}

/** Runs `fn` under RLS as the signed-in user (lib/db.ts). */
export async function asUser<T>(user: CurrentUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRls(user.id, fn);
}
