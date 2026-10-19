import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Magic-link / OTP callback. Handles both flows:
 *  - PKCE:      ?code=...            -> exchangeCodeForSession
 *  - token hash: ?token_hash=&type= -> verifyOtp
 *
 * Cookies are written directly onto the redirect response so the session
 * persists (writing via next/headers cookies() is unreliable across a redirect
 * in a Route Handler).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const errorDescription = searchParams.get("error_description");
  let next = searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("/auth")) next = "/";

  const redirect = NextResponse.redirect(`${origin}${next}`);

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription)}`,
    );
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          redirect.cookies.set(name, value, options),
        );
      },
    },
  });

  let error = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else {
    error = new Error("Missing auth parameters");
  }

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return redirect;
}
