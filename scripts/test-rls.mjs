// Runs the RLS suite against a throwaway database: TEST_DATABASE_URL is reset
// to the current migrations, then tests/rls runs as each role.
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim());
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL (a database this script may wipe).");
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL must not be the app database.");
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };

// Each suite counts rows, so each gets a freshly migrated database.
function reset() {
  execSync(`pnpm -s prisma db execute --url "${url}" --stdin`, {
    input: "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public;",
    stdio: ["pipe", "ignore", "inherit"],
    env,
  });
  execSync("pnpm -s prisma migrate deploy", { stdio: ["ignore", "ignore", "inherit"], env });
}

const files = readdirSync("tests/rls").filter((f) => f.endsWith(".test.ts")).sort();
let failed = false;
for (const file of files) {
  reset();
  try {
    execSync(`pnpm -s vitest run --config vitest.rls.config.ts --reporter=verbose tests/rls/${file}`, { stdio: "inherit", env });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
