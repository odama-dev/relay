// Runs a command with an env file's variables taking precedence over .env, so
// Prisma, tsx and the seeds reach another database without editing .env:
//   node scripts/with-env.mjs .env.cloud prisma migrate deploy
// (Prisma and `tsx --env-file` never override variables already set.)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const [file, ...cmd] = process.argv.slice(2);
if (!file || cmd.length === 0) {
  console.error("Usage: node scripts/with-env.mjs <env-file> <command> [args…]");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`${file} not found. Copy the Supabase Cloud block of .env.example into it.`);
  process.exit(1);
}

// KEY=value, KEY="value" or KEY='value'; an `export ` prefix and a trailing
// `# comment` are dropped (a # inside quotes or glued to the value is kept).
const vars = {};
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m) continue;
  let value = m[2].trim();
  const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(value);
  value = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
  vars[m[1]] = value;
}

const isLocal = (v) => /127\.0\.0\.1|localhost/.test(v);
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  if (!vars[key] || isLocal(vars[key])) {
    console.error(`${file}: ${key} must point at the remote database.`);
    process.exit(1);
  }
}

if (cmd.some((c) => /seed|create-admin/.test(c))) {
  // Without the Supabase URL + service role key the seed silently gives every
  // profile a random id with no auth user behind it, and nobody can sign in.
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!vars[key] || isLocal(vars[key])) {
      console.error(`${file}: ${key} must point at the remote Supabase project (auth users are created through it).`);
      process.exit(1);
    }
  }
  // The seed resets every seeded person's password, the admin's included.
  if (cmd.some((c) => /seed/.test(c)) && (!vars.SEED_PASSWORD || vars.SEED_PASSWORD === "odama-dev-123" || vars.SEED_PASSWORD.length < 12)) {
    console.error(`${file}: set a strong SEED_PASSWORD (12+ characters) before seeding a remote database.`);
    process.exit(1);
  }
}

const host = new URL(vars.DIRECT_URL).host;
console.log(`→ ${cmd.join(" ")}  (${file}, ${host})`);
const res = spawnSync(cmd[0], cmd.slice(1), {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...vars },
});
process.exit(res.status ?? 1);
