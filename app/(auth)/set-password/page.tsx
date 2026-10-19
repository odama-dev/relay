import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../auth-shell";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/** Reached from an invite or password email, with a fresh session already set. */
export default async function SetPasswordPage() {
  if (!supabaseConfigured) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  return (
    <AuthShell
      title="Set your password"
      description={
        <>
          You&apos;ll sign in as <span className="text-foreground">{user.email}</span> with this
          password from now on.
        </>
      }
    >
      <SetPasswordForm className="mt-6" />
    </AuthShell>
  );
}
