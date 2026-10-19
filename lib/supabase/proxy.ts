import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env, supabaseConfigured } from "@/lib/env";

// Headers used to forward the identity `getUser()` already revalidated against
// Supabase's Auth server, so `lib/auth.ts` doesn't pay for a second network
// round trip on every request. Always stripped from the inbound request first
// so a client can never spoof them.
const USER_ID_HEADER = "x-app-user-id";
const USER_EMAIL_HEADER = "x-app-user-email";

/**
 * Refreshes the Supabase auth session on every request and gates the app routes.
 * No-op when Supabase is not configured (local dev with DEV_AUTH_BYPASS).
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(USER_ID_HEADER);
  requestHeaders.delete(USER_EMAIL_HEADER);

  if (!supabaseConfigured) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginRoute = pathname.startsWith("/login");
  // /auth/* handles the magic-link code exchange — never gate it.
  const isAuthFlow = pathname.startsWith("/auth");
  // Invite landing pages are opened before the invitee has any session.
  const isInvite = pathname.startsWith("/invite/");
  // Machine callers authenticate themselves inside the handler: Xendit with
  // its callback token, the VPS cron with CRON_SECRET, headless Chrome with a
  // one-time print token (lib/invoices/pdf.ts).
  const isMachine =
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/invoice-pdf/") ||
    // Local stand-in for the Xendit checkout (dev only, see app/dev/pay).
    pathname.startsWith("/dev/pay/");

  if (!user && !isLoginRoute && !isAuthFlow && !isInvite && !isMachine) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user?.email) {
    requestHeaders.set(USER_ID_HEADER, user.id);
    requestHeaders.set(USER_EMAIL_HEADER, user.email);
    const forwarded = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((cookie) => forwarded.cookies.set(cookie));
    response = forwarded;
  }

  return response;
}
