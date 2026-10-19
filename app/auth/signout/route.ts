import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Where requireUser() sends a Supabase session that has no app access (never
 * invited, or deactivated). Clears the session on the redirect response so
 * /login doesn't bounce straight back into the app.
 */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const response = NextResponse.redirect(`${origin}/login`);

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return response;

  await supabase.auth.signOut({ scope: "local" });
  response.headers.set("location", `${origin}/login?error=no-access`);
  return response;
}
