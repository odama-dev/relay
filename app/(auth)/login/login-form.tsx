"use client";

import { useState } from "react";
import { requestPasswordReset, signInWithPassword } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/password-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "sign-in" | "forgot";

export function LoginForm({ className, next }: { className?: string; next?: string }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ error?: string; sent?: boolean; loading?: boolean }>({});

  const switchTo = (m: Mode) => {
    setMode(m);
    setState({});
  };

  async function signIn(formData: FormData) {
    setState({ loading: true });
    // Redirects on success, so only failures come back.
    const res = await signInWithPassword(formData);
    if (res && !res.ok) setState({ error: res.error });
  }

  async function forgot(formData: FormData) {
    setState({ loading: true });
    const res = await requestPasswordReset(formData);
    setState(res.ok ? { sent: true } : { error: res.error });
  }

  if (mode === "forgot" && state.sent) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="rounded-lg border p-4 text-body">
          If <span className="font-medium">{email}</span> has an account, a link to reset your
          password is on its way.
        </div>
        <Button variant="ghost" size="sm" className="self-start" onClick={() => switchTo("sign-in")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  const emailField = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="email">Work email</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </div>
  );

  if (mode === "forgot") {
    return (
      <form action={forgot} className={cn("flex flex-col gap-3", className)}>
        <p className="text-caption text-muted-foreground">
          We&apos;ll email you a link to choose a new password.
        </p>
        {emailField}
        {state.error && <p className="text-destructive text-caption">{state.error}</p>}
        <Button type="submit" disabled={state.loading}>
          {state.loading ? "Sending…" : "Send reset link"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => switchTo("sign-in")}>
          Back to sign in
        </Button>
      </form>
    );
  }

  return (
    <form action={signIn} className={cn("flex flex-col gap-3", className)}>
      <input type="hidden" name="next" value={next ?? "/"} />
      {emailField}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <button
            type="button"
            onClick={() => switchTo("forgot")}
            className="text-caption text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            Forgot password?
          </button>
        </div>
        <PasswordField id="password" name="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="text-destructive text-caption">{state.error}</p>}
      <Button type="submit" disabled={state.loading}>
        {state.loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
