/**
 * Local seed: one person per role, two clients, client and internal
 * projects, sections, tasks, a few weeks of time (with out-of-scope work),
 * and a draft invoice. Idempotent-ish: it refuses to run on a database that
 * already has projects.
 *
 * With Supabase configured, each person also gets an auth user with the
 * password in SEED_PASSWORD (default "odama-dev-123"). Without it, sign in
 * through DEV_AUTH_BYPASS and switch people with DEV_AUTH_EMAIL.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, type UserRole } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? "odama-dev-123";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const monday = (iso: string) => addDays(iso, -((day(iso).getUTCDay() + 6) % 7));

const PEOPLE: { key: string; name: string; email: string; role: UserRole; admin?: boolean; employment?: "full_time" | "contract" | "freelancer" }[] = [
  { key: "rafi", name: "Rafi Rohmat", email: (process.env.ADMIN_EMAILS ?? "hellorafi@odama.io").split(",")[0]!.trim().toLowerCase(), role: "c_level", admin: true },
  { key: "pm", name: "Putri Maharani", email: "putri@odama.io", role: "pm" },
  { key: "pm2", name: "Bayu Pratama", email: "bayu@odama.io", role: "pm" },
  { key: "dev", name: "Ana Wijaya", email: "ana@odama.io", role: "designer_dev" },
  { key: "dev2", name: "Dimas Saputra", email: "dimas@odama.io", role: "designer_dev", employment: "contract" },
  { key: "dev3", name: "Sekar Ayu", email: "sekar@odama.io", role: "designer_dev", employment: "freelancer" },
  { key: "sales", name: "Raka Aditya", email: "raka@odama.io", role: "sales" },
  { key: "finance", name: "Lestari Dewi", email: "lestari@odama.io", role: "finance", employment: "freelancer" },
  { key: "hr", name: "Nadia Kusuma", email: "nadia@odama.io", role: "hr" },
];

async function authUserId(email: string, name: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return randomUUID();
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (data.user) return data.user.id;
  // Already exists: find it.
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  const found = list.data.users.find((u) => u.email?.toLowerCase() === email);
  if (!found) throw error ?? new Error(`Couldn't create ${email}`);
  await admin.auth.admin.updateUserById(found.id, { password: PASSWORD });
  return found.id;
}

/**
 * C-Level dashboard inputs (PRD/Clevel dashboard.md §3): costs, capacity, a
 * leave override, revenue targets, reference FX rates, retainer fees and a
 * few past months of opex. Runs on its own when the tables are empty, so an
 * existing local database picks it up too.
 */
async function seedBusinessData() {
  if ((await prisma.personCost.count()) > 0) return;
  const people = await prisma.profile.findMany({ where: { status: "active" } });
  if (people.length === 0) return;
  const from = day(`${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`);
  const monthly: Record<string, number> = { c_level: 45_000_000, pm: 22_000_000, designer_dev: 16_000_000, sales: 16_000_000, finance: 10_000_000, hr: 14_000_000 };
  const weekly = { full_time: 40, contract: 32, freelancer: 20 } as const;
  const boss = people.find((p) => p.role === "c_level")?.id ?? null;
  await prisma.personCost.createMany({
    data: people.map((p) => ({ userId: p.id, effectiveFrom: from, monthlyCostIdr: monthly[p.role]! * (p.employmentType === "freelancer" ? 0.6 : 1), createdBy: boss })),
  });
  await prisma.personCapacity.createMany({
    data: people.filter((p) => p.role !== "c_level").map((p) => ({ userId: p.id, effectiveFrom: from, weeklyHours: weekly[p.employmentType], createdBy: boss })),
  });
  const ana = people.find((p) => p.email === "ana@odama.io");
  if (ana) {
    const leave = addDays(monday(today), 7);
    await prisma.capacityOverride.create({ data: { userId: ana.id, periodStart: day(leave), periodEnd: day(addDays(leave, 1)), availableHours: 0, reason: "Annual leave", createdBy: boss } });
  }
  const year = Number(today.slice(0, 4));
  await prisma.revenueTarget.createMany({
    data: [
      { year, month: null, targetIdr: 2_400_000_000, createdBy: boss },
      { year, month: Number(today.slice(5, 7)), targetIdr: 240_000_000, createdBy: boss },
    ],
    skipDuplicates: true,
  });
  await prisma.fxReferenceRate.createMany({
    data: [
      { currency: "USD", rateToIdr: 16_300, effectiveFrom: day(`${today.slice(0, 7)}-01`), updatedBy: boss },
      { currency: "EUR", rateToIdr: 17_800, effectiveFrom: day(`${today.slice(0, 7)}-01`), updatedBy: boss },
      { currency: "SGD", rateToIdr: 12_600, effectiveFrom: day(`${today.slice(0, 7)}-01`), updatedBy: boss },
      { currency: "AUD", rateToIdr: 10_700, effectiveFrom: day(`${today.slice(0, 7)}-01`), updatedBy: boss },
    ],
    skipDuplicates: true,
  });
  for (const p of await prisma.project.findMany({ where: { contractType: "retainer" } })) {
    const fee = p.currency === "IDR" ? 60_000_000 : 4_000;
    await prisma.projectContract.upsert({ where: { projectId: p.id }, create: { projectId: p.id, retainerFeePerMonth: fee }, update: { retainerFeePerMonth: fee } });
  }
  const finance = people.find((p) => p.role === "finance")?.id ?? boss;
  const thisMonth = `${today.slice(0, 7)}-01`;
  const pastMonths = [1, 2, 3, 4, 5].map((n) => {
    const d = new Date(day(thisMonth));
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString().slice(0, 10);
  });
  await prisma.expense.createMany({
    data: pastMonths.flatMap((m) => [
      { expenseDate: day(addDays(m, 1)), vendor: "Office rent", description: "Studio space", category: "rent" as const, kind: "opex" as const, amount: 12_000_000, currency: "IDR", createdBy: finance },
      { expenseDate: day(addDays(m, 2)), vendor: "PLN", description: "Electricity · studio", category: "utilities" as const, kind: "opex" as const, amount: 1_150_000, currency: "IDR", createdBy: finance },
      { expenseDate: day(addDays(m, 4)), vendor: "Figma", description: "Professional plan, 3 seats", category: "software" as const, kind: "opex" as const, amount: 45, currency: "USD", createdBy: finance },
    ]),
  });
  console.log("Seeded C-Level dashboard inputs (costs, capacity, targets, FX, retainer fees, past opex).");
}

async function main() {
  if ((await prisma.project.count()) > 0) {
    console.log("Database already has projects — skipping the base seed.");
    await seedBusinessData();
    return;
  }

  const id: Record<string, string> = {};
  for (const p of PEOPLE) {
    const existing = await prisma.profile.findUnique({ where: { email: p.email } });
    const profile =
      existing ??
      (await prisma.profile.create({
        data: {
          id: await authUserId(p.email, p.name),
          email: p.email,
          fullName: p.name,
          role: p.role,
          isAdmin: Boolean(p.admin),
          employmentType: p.employment ?? "full_time",
          status: "active",
        },
      }));
    id[p.key] = profile.id;
  }

  const acme = await prisma.client.create({
    data: {
      code: "ACME",
      name: "Acme Corp",
      country: "United Kingdom",
      timezone: "Europe/London",
      defaultCurrency: "USD",
      billingEmail: "billing@acme.example",
      billingAddress: "1 King Street\nLondon EC2V 8AU",
      createdBy: id.sales,
      contacts: { create: [{ name: "Jane Doe", email: "jane@acme.example", title: "Head of Marketing", isPrimary: true }] },
    },
  });
  const nusa = await prisma.client.create({
    data: {
      code: "NUSA",
      name: "Nusa Coffee",
      country: "Indonesia",
      timezone: "Asia/Jakarta",
      defaultCurrency: "IDR",
      billingEmail: "finance@nusa.example",
      billingAddress: "Jl. Senopati No. 10\nJakarta Selatan",
      createdBy: id.sales,
      contacts: { create: [{ name: "Budi Hartono", email: "budi@nusa.example", title: "Founder", isPrimary: true }] },
    },
  });

  const start = addDays(today, -60);
  const website = await prisma.project.create({
    data: {
      name: "Website Redesign",
      kind: "client",
      clientId: acme.id,
      contractType: "fixed",
      currency: "USD",
      pmId: id.pm!,
      startDate: day(start),
      endDate: day(addDays(today, 45)),
      links: { figma: "https://www.figma.com/file/example", slack_channel: "#acme-website" },
      createdBy: id.sales,
      contract: { create: { contractValue: 24000 } },
      budget: { create: { budgetHours: 120, alertThresholds: [75, 100] } },
    },
  });
  const retainer = await prisma.project.create({
    data: {
      name: "Brand Retainer",
      kind: "client",
      clientId: nusa.id,
      contractType: "retainer",
      currency: "IDR",
      pmId: id.pm2!,
      startDate: day(`${addDays(today, -75).slice(0, 7)}-01`),
      createdBy: id.sales,
      contract: { create: { contractValue: 45_000_000 } },
      budget: { create: { retainerHoursPerMonth: 40, rolloverMode: "capped", rolloverCapHours: 10, alertThresholds: [50, 80, 100] } },
    },
  });
  const internal = await prisma.project.create({
    data: { name: "Studio Website", kind: "internal", currency: "IDR", pmId: id.pm!, startDate: day(start), createdBy: id.pm, budget: { create: {} } },
  });

  await prisma.projectMember.createMany({
    data: [
      { projectId: website.id, userId: id.dev!, addedBy: id.pm },
      { projectId: website.id, userId: id.dev2!, addedBy: id.pm },
      { projectId: website.id, userId: id.sales!, addedBy: id.pm },
      { projectId: retainer.id, userId: id.dev!, addedBy: id.pm2 },
      { projectId: retainer.id, userId: id.dev3!, addedBy: id.pm2 },
      { projectId: internal.id, userId: id.dev2!, addedBy: id.pm },
    ],
    skipDuplicates: true,
  });

  // Sections: General exists already (trigger); rename it and add more.
  const sectionsFor = async (projectId: string, names: string[]) => {
    const general = await prisma.section.findFirstOrThrow({ where: { projectId } });
    await prisma.section.update({ where: { id: general.id }, data: { name: names[0] } });
    const out = [general.id];
    for (const [i, name] of names.slice(1).entries()) out.push((await prisma.section.create({ data: { projectId, name, position: i + 1 } })).id);
    return out;
  };
  const [discovery, design, dev] = await sectionsFor(website.id, ["Discovery", "Design", "Development"]);
  const [monthly] = await sectionsFor(retainer.id, ["Monthly requests"]);
  const [intGeneral] = await sectionsFor(internal.id, ["General"]);

  const T = async (projectId: string, sectionId: string, title: string, extra: Partial<{ ownerId: string; status: "todo" | "in_progress" | "review" | "done" | "blocked"; priority: "urgent" | "high" | "normal" | "low"; due: number; collab: string[] }> = {}) => {
    const t = await prisma.task.create({
      data: {
        projectId,
        sectionId,
        title,
        ownerId: extra.ownerId ?? null,
        status: extra.status ?? "todo",
        priority: extra.priority ?? "normal",
        dueDate: extra.due !== undefined ? day(addDays(today, extra.due)) : null,
        position: Math.random() * 10_000,
        createdBy: id.pm,
        description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Brief for “${title}”.` }] }] },
      },
    });
    if (extra.collab?.length) await prisma.taskCollaborator.createMany({ data: extra.collab.map((userId) => ({ taskId: t.id, userId })) });
    await prisma.taskActivity.create({ data: { taskId: t.id, actorId: id.pm, type: "created" } });
    return t;
  };

  const tasks = {
    kickoff: await T(website.id, discovery!, "Kickoff workshop", { ownerId: id.pm, status: "done", due: -50 }),
    audit: await T(website.id, discovery!, "Content audit", { ownerId: id.dev, status: "done", due: -40 }),
    sitemap: await T(website.id, discovery!, "Sitemap & user flows", { ownerId: id.dev, status: "review", due: -2, collab: [id.dev2!] }),
    wireframes: await T(website.id, design!, "Wireframes — key pages", { ownerId: id.dev, status: "in_progress", priority: "high", due: 3 }),
    visual: await T(website.id, design!, "Visual design system", { ownerId: id.dev2, status: "todo", priority: "high", due: 10 }),
    hero: await T(website.id, design!, "Homepage hero variations", { ownerId: id.dev, status: "blocked", priority: "urgent", due: -1 }),
    cms: await T(website.id, dev!, "CMS setup", { ownerId: id.dev2, status: "todo", due: 20 }),
    frontend: await T(website.id, dev!, "Frontend build", { ownerId: id.dev2, status: "todo", due: 30, collab: [id.dev!] }),
    social: await T(retainer.id, monthly!, "Social media templates", { ownerId: id.dev3, status: "in_progress", due: 2 }),
    packaging: await T(retainer.id, monthly!, "Seasonal packaging update", { ownerId: id.dev, status: "todo", priority: "high", due: 6 }),
    menu: await T(retainer.id, monthly!, "Menu board redesign", { ownerId: id.dev3, status: "done", due: -20 }),
    portfolio: await T(internal.id, intGeneral!, "Portfolio case study: Acme", { ownerId: id.dev2, status: "todo", due: 14 }),
  };

  await prisma.taskComment.create({
    data: { taskId: tasks.wireframes.id, authorId: id.pm!, body: { text: "@Ana Wijaya can we review the pricing page first?", mentions: [id.dev] } },
  });

  // Four weeks of time; weeks before the current one get locked below.
  const entries: { userId: string; date: string; minutes: number; taskId?: string; categoryId?: string; note?: string; oos?: "pending" | "approved" }[] = [];
  const categories = await prisma.workCategory.findMany();
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;
  for (let back = 27; back >= 0; back--) {
    const d = addDays(today, -back);
    const dow = day(d).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    entries.push({ userId: id.dev!, date: d, minutes: 180, taskId: back > 14 ? tasks.audit.id : tasks.wireframes.id });
    entries.push({ userId: id.dev!, date: d, minutes: 120, taskId: tasks.social.id === "" ? undefined : back % 2 ? tasks.packaging.id : tasks.menu.id });
    entries.push({ userId: id.dev2!, date: d, minutes: 240, taskId: back > 10 ? tasks.sitemap.id : tasks.visual.id });
    entries.push({ userId: id.dev3!, date: d, minutes: 150, taskId: tasks.social.id });
    if (dow === 1) entries.push({ userId: id.dev!, date: d, minutes: 60, categoryId: cat("Meeting internal"), note: "Weekly studio sync" });
    if (dow === 3) entries.push({ userId: id.pm!, date: d, minutes: 90, taskId: tasks.kickoff.id });
    if (back === 1) entries.push({ userId: id.sales!, date: d, minutes: 60, categoryId: cat("Pitching"), note: "Pitch deck for a lead" });
  }
  entries.push({ userId: id.dev!, date: addDays(today, -3), minutes: 120, taskId: tasks.hero.id, note: "Client asked for an animated hero (not in scope)", oos: "pending" });
  entries.push({ userId: id.dev2!, date: addDays(today, -9), minutes: 240, taskId: tasks.visual.id, note: "Extra dark-mode palette requested by client", oos: "approved" });
  for (const e of entries.filter((x) => x.taskId || x.categoryId)) {
    await prisma.timeEntry.create({
      data: {
        userId: e.userId,
        entryDate: day(e.date),
        minutes: e.minutes,
        taskId: e.taskId ?? null,
        categoryId: e.categoryId ?? null,
        note: e.note ?? null,
        oosStatus: e.oos ?? "none",
        ...(e.oos === "approved" ? { oosReviewedBy: id.pm, oosReviewedAt: new Date() } : {}),
      },
    });
  }
  for (let w = 1; w <= 3; w++) {
    await prisma.timesheetLock.upsert({ where: { weekStart: day(addDays(monday(today), -7 * w)) }, create: { weekStart: day(addDays(monday(today), -7 * w)) }, update: {} });
  }

  // A draft invoice with two payment requests (Down Payment / Final Payment).
  await prisma.invoice.create({
    data: {
      projectId: website.id,
      clientId: acme.id,
      currency: "USD",
      issueDate: day(today),
      billToName: acme.name,
      billToAddress: acme.billingAddress,
      billToEmail: acme.billingEmail,
      subtotal: 12000,
      total: 12000,
      notes: "Thank you for working with Odama.",
      createdBy: id.sales,
      items: { create: [{ description: "Website redesign — design phase", quantity: 1, unitPrice: 12000, amount: 12000, position: 0 }] },
      paymentRequests: {
        create: [
          { label: "Down Payment", amount: 6000, dueDate: day(addDays(today, 7)), position: 0 },
          { label: "Final Payment", amount: 6000, dueDate: day(addDays(today, 37)), position: 1 },
        ],
      },
    },
  });

  // Studio expenses: subscriptions and utilities (opex), a laptop (capex).
  const thisMonth = `${today.slice(0, 7)}-01`;
  await prisma.expense.createMany({
    data: [
      { expenseDate: day(thisMonth), vendor: "Figma", description: "Professional plan, 3 seats", category: "software", kind: "opex", amount: 45, currency: "USD", createdBy: id.finance },
      { expenseDate: day(addDays(thisMonth, 2)), vendor: "PLN", description: "Electricity · studio", category: "utilities", kind: "opex", amount: 1_250_000, currency: "IDR", createdBy: id.finance },
      { expenseDate: day(addDays(thisMonth, 4)), vendor: "Biznet", description: "Fiber internet 300 Mbps", category: "internet", kind: "opex", amount: 650_000, currency: "IDR", createdBy: id.finance },
      { expenseDate: day(addDays(thisMonth, 6)), vendor: "iBox", description: "MacBook Pro 14\" for Ana", category: "equipment", kind: "capex", amount: 32_999_000, currency: "IDR", createdBy: id.finance },
    ],
  });

  await seedBusinessData();

  console.log(`Seeded ${PEOPLE.length} people, 2 clients, 3 projects, ${Object.keys(tasks).length} tasks, ${entries.length} time entries.`);
  console.log(`Sign in as any seeded email${process.env.NEXT_PUBLIC_SUPABASE_URL ? ` with password ${PASSWORD}` : " via DEV_AUTH_EMAIL"}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
