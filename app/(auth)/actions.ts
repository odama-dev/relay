"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { passwordSchema } from "@/lib/validation";
import { acceptInvitation, sendPasswordReset } from "@/lib/people/accounts";
import { run, parseOrFail, fail, type ActionResult } from "@/lib/actions";

function safeNext(value: FormDataEntryValue | null | undefined): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth") ? next : "/";
}

/** Email + password sign-in (M0.2). Deactivated users get a clear message. */
export async function signInWithPassword(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const res = await run(async () => {
    if (!email || !password) fail("Enter your email and password.");
    if (!supabaseConfigured) fail("Sign-in isn't configured yet. Set the Supabase env vars.");

    const profile = await prisma.profile.findUnique({ where: { email }, select: { status: true } });
    if (profile?.status === "deactivated") {
      fail("Your account has been deactivated. Contact HR or an admin if you think this is a mistake.");
    }
    if (profile?.status === "invited") fail("Finish setting up your account from the invitation email first.");

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      fail(error.code === "invalid_credentials" ? "Wrong email or password." : error.message);
    }
  });
  if (!res.ok) return res;
  redirect(safeNext(formData.get("next")));
}

/** Always answers the same way so it can't be used to probe which emails exist. */
export async function requestPasswordReset(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  return run(async () => {
    if (!email) fail("Enter your email.");
    await sendPasswordReset(email);
  });
}

/** Signed in (after a recovery link, or from the account menu): change password. */
export async function updatePassword(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const { password } = parseOrFail(passwordSchema, raw);
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) fail(error.code === "same_password" ? "That's already your password." : error.message);
  });
}

/** Invitation landing (M0.1): create the password, activate, sign in. */
export async function acceptInvite(token: string, raw: unknown): Promise<ActionResult> {
  const res = await run(async () => {
    const { password } = parseOrFail(passwordSchema, raw);
    const { email } = await acceptInvitation(token, password);
    if (supabaseConfigured) {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) fail("Your password is set. Sign in to continue.");
    }
  });
  if (!res.ok) return res;
  redirect("/");
}

export async function signOut() {
  if (supabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
