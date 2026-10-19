"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing for links emailed through the Supabase admin API (invite, password
 * reset). Those use the implicit flow — the session arrives in the URL hash,
 * which never reaches the server — so it is picked up here in the browser.
 * PKCE-style `?code=` / `?token_hash=` links are handed to /auth/callback.
 */
export default function ConfirmPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    let next = url.searchParams.get("next") ?? "/";
    if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/auth")) next = "/";

    if (url.searchParams.has("code") || url.searchParams.has("token_hash")) {
      window.location.replace(`/auth/callback${url.search}`);
      return;
    }

    const hash = new URLSearchParams(url.hash.slice(1));
    const failure = hash.get("error_description") ?? url.searchParams.get("error_description");
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    if (failure || !accessToken || !refreshToken) {
      window.location.replace(
        `/login?error=${encodeURIComponent(failure ?? "This link is invalid or has expired.")}`,
      );
      return;
    }

    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) setError(sessionError.message);
        else window.location.replace(next);
      });
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <p className="text-body text-muted-foreground" role="status">
        {error ?? "Signing you in…"}
      </p>
    </div>
  );
}
