import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withRls } from "@/lib/db";

afterAll(() => prisma.$disconnect());

// Guards the suite itself: if withRls ever stopped switching roles, every
// "denied" assertion elsewhere would be meaningless.
it("runs user queries as `authenticated` with the user's claims", async () => {
  const id = randomUUID();
  const [row] = await withRls(id, (tx) =>
    tx.$queryRaw<{ u: string; uid: string }[]>`SELECT current_user AS u, app.uid()::text AS uid`,
  );
  expect(row).toEqual({ u: "authenticated", uid: id });
});
