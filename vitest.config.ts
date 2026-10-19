import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Next.js resolves `server-only` to a no-op on the server; tests are server code.
    alias: { "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // The RLS suite needs a database — run it with `pnpm test:rls`.
    exclude: ["node_modules", ".next", "tests/rls/**"],
  },
});
