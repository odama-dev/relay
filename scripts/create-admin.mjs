// First admin on a fresh environment:
//   node --env-file=.env scripts/create-admin.mjs you@odama.io "Your Name" "a-strong-password"
// Creates the Supabase auth user with a password and an active C-Level admin
// profile with the same id. Everyone else is invited from People.
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

const [email, fullName, password] = process.argv.slice(2);
if (!email || !fullName || !password || password.length < 8) {
  console.error('Usage: node --env-file=.env scripts/create-admin.mjs <email> "<full name>" <password (8+ chars)>');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const prisma = new PrismaClient();
const normalized = email.trim().toLowerCase();

let { data, error } = await admin.auth.admin.createUser({ email: normalized, password, email_confirm: true, user_metadata: { full_name: fullName } });
if (error && /already/i.test(error.message)) {
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const found = list.data.users.find((u) => u.email?.toLowerCase() === normalized);
  if (!found) throw error;
  await admin.auth.admin.updateUserById(found.id, { password });
  data = { user: found };
  error = null;
}
if (error || !data?.user) throw error ?? new Error("Couldn't create the auth user");

await prisma.profile.upsert({
  where: { id: data.user.id },
  create: { id: data.user.id, email: normalized, fullName, role: "c_level", isAdmin: true, status: "active" },
  update: { isAdmin: true, status: "active" },
});
await prisma.$disconnect();
console.log(`Admin ready: ${normalized}. Sign in at ${process.env.NEXT_PUBLIC_APP_URL ?? "the app"}/login`);
