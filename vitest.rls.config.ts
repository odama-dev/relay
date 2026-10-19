import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// The RLS suite runs alone against TEST_DATABASE_URL (scripts/test-rls.mjs).
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: { "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
