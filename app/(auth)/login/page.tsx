import { redirect } from "next/navigation";
import { devAuthBypass, supabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { AuthNotice, AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "no-access": "This account doesn't have access to Odama OS. It may have been deactivated — contact HR or an admin.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (devAuthBypass) redirect("/");
  if (await getCurrentUser()) redirect("/");

  const { error, next } = await searchParams;
  const message = error ? (ERRORS[error] ?? error) : null;

  return (
    <AuthShell title="Sign in" description="Odama OS is invite-only.">
      {message && <AuthNotice>{message}</AuthNotice>}
      {supabaseConfigured ? (
        <LoginForm className="mt-6" next={next} />
      ) : (
        <div className="mt-6 rounded-lg bg-foreground/[0.03] p-4 text-body text-muted-foreground">
          Authentication is not configured. Set <code className="text-foreground">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-foreground">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, or run locally with{" "}
          <code className="text-foreground">DEV_AUTH_BYPASS=true</code>.
        </div>
      )}
    </AuthShell>
  );
}
