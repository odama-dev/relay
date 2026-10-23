/**
 * A year of studio history on top of the base seed (`pnpm db:seed`): past and
 * running client projects across currencies and contract types, tasks, daily
 * time logs, issued invoices with Xendit-style payments, monthly expenses,
 * FX history, revenue targets, leave, corrections and audit rows.
 *
 * Additive and run once: it refuses to run when its first client (LUMN)
 * exists. Writes go through the system connection, so the derived-rule
 * triggers (project codes, billable flag, out-of-scope rules) still apply
 * while the RLS-only guards (week locks, invoice locking) are skipped — this
 * is history, written after the fact. Deterministic: the same date gives the
 * same data.
 *
 *   pnpm db:seed && pnpm db:seed:history
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, type ContractType, type EmploymentType, type ProjectStatus, type TaskStatus } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Dates and randomness
// ---------------------------------------------------------------------------

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso: string, n: number) => {
  const d = day(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const monthName = (iso: string) => day(iso).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** 17:00 in Jakarta on that day. */
const at = (iso: string, hourWib = 17) => new Date(`${iso}T${String(hourWib - 7).padStart(2, "0")}:00:00Z`);
const isWeekend = (iso: string) => [0, 6].includes(day(iso).getUTCDay());
const nextWeekday = (iso: string): string => (isWeekend(iso) ? nextWeekday(addDays(iso, 1)) : iso);

const START = addDays(today, -365);

let seed = 20261019;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
const quarter = (minutes: number) => Math.max(15, Math.round(minutes / 15) * 15);

/** Indonesian public holidays in the window — nobody logs time. */
const HOLIDAYS = new Set([
  "2025-12-25", "2025-12-26", "2026-01-01", "2026-01-16", "2026-02-17", "2026-03-19", "2026-03-20", "2026-03-23",
  "2026-03-24", "2026-04-03", "2026-05-01", "2026-05-14", "2026-05-27", "2026-06-01", "2026-06-16", "2026-08-17", "2026-08-25",
]);

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

// ---------------------------------------------------------------------------
// The studio's year
// ---------------------------------------------------------------------------

type ClientSeed = { code: string; name: string; country: string; timezone: string; currency: string; email: string; address: string; contact: [string, string, string]; archived?: boolean };

const CLIENTS: ClientSeed[] = [
  { code: "LUMN", name: "Lumen Health", country: "Singapore", timezone: "Asia/Singapore", currency: "SGD", email: "accounts@lumenhealth.example", address: "71 Robinson Road #14-01\nSingapore 068895", contact: ["Grace Tan", "grace@lumenhealth.example", "Head of Product"] },
  { code: "BARA", name: "Bara Living", country: "Indonesia", timezone: "Asia/Jakarta", currency: "IDR", email: "finance@baraliving.example", address: "Jl. Kemang Raya No. 45\nJakarta Selatan 12730", contact: ["Sari Wulandari", "sari@baraliving.example", "Marketing Director"] },
  { code: "NWND", name: "Northwind Labs", country: "United States", timezone: "America/Los_Angeles", currency: "USD", email: "ap@northwind.example", address: "500 Howard Street, Suite 300\nSan Francisco, CA 94105", contact: ["Michael Chen", "michael@northwind.example", "VP Marketing"] },
  { code: "KRNA", name: "Kirana Hotels", country: "Indonesia", timezone: "Asia/Makassar", currency: "IDR", email: "procurement@kirana.example", address: "Jl. Raya Seminyak No. 88\nBadung, Bali 80361", contact: ["I Made Surya", "made@kirana.example", "General Manager"] },
  { code: "TIDE", name: "Tidepool Studio", country: "Australia", timezone: "Australia/Sydney", currency: "AUD", email: "hello@tidepool.example", address: "12 Crown Street\nSurry Hills NSW 2010", contact: ["Olivia Hart", "olivia@tidepool.example", "Founder"] },
  { code: "HALC", name: "Halcyon GmbH", country: "Germany", timezone: "Europe/Berlin", currency: "EUR", email: "buchhaltung@halcyon.example", address: "Torstraße 140\n10119 Berlin", contact: ["Lena Vogel", "lena@halcyon.example", "Communications Lead"] },
  { code: "SGRA", name: "Sagara Fintech", country: "Indonesia", timezone: "Asia/Jakarta", currency: "IDR", email: "finance@sagara.example", address: "Treasury Tower Lt. 22, SCBD\nJakarta Selatan 12190", contact: ["Andi Nugroho", "andi@sagara.example", "Chief Product Officer"] },
  { code: "PINE", name: "Pinewood Coffee", country: "Indonesia", timezone: "Asia/Jakarta", currency: "IDR", email: "admin@pinewood.example", address: "Jl. Braga No. 21\nBandung 40111", contact: ["Rudi Setiawan", "rudi@pinewood.example", "Owner"], archived: true },
];

type Template = { section: string; tasks: string[] }[];

const T_WEB: Template = [
  { section: "Discovery", tasks: ["Kickoff workshop", "Stakeholder interviews", "Competitive audit", "Sitemap & user flows"] },
  { section: "Design", tasks: ["Wireframes — key pages", "Visual direction", "UI design — core pages", "Responsive layouts", "Design QA"] },
  { section: "Build", tasks: ["Frontend build", "CMS integration", "Content migration", "Launch checklist"] },
];
const T_APP: Template = [
  { section: "Research", tasks: ["User interviews", "Journey mapping", "Heuristic review"] },
  { section: "UX", tasks: ["Information architecture", "Wireframes — onboarding", "Wireframes — core flows", "Usability test round 1"] },
  { section: "UI", tasks: ["UI kit", "High-fidelity screens", "Interactive prototype", "Usability test round 2"] },
  { section: "Handoff", tasks: ["Developer handoff", "Design QA"] },
];
const T_BRAND: Template = [
  { section: "Research", tasks: ["Brand audit", "Positioning workshop", "Moodboards"] },
  { section: "Identity", tasks: ["Logo exploration", "Logo refinement", "Color & type system", "Brand guidelines"] },
  { section: "Rollout", tasks: ["Stationery set", "Signage & wayfinding", "Social templates", "Photography art direction"] },
];
const T_SYSTEM: Template = [
  { section: "Foundations", tasks: ["Design tokens", "Typography scale", "Color system", "Iconography"] },
  { section: "Components", tasks: ["Buttons & inputs", "Navigation", "Data tables", "Forms & validation", "Modals & sheets"] },
  { section: "Documentation", tasks: ["Usage guidelines", "Storybook setup", "Contribution guide"] },
];
const T_REPORT: Template = [
  { section: "Content", tasks: ["Copy outline", "Data collection", "Chart design"] },
  { section: "Design", tasks: ["Layout system", "Cover concepts", "Spreads — sections 1–4", "Spreads — sections 5–8"] },
  { section: "Production", tasks: ["Proof round", "Print-ready files", "Interactive PDF"] },
];
const T_PACK: Template = [
  { section: "Concept", tasks: ["Shelf audit", "Packaging concepts", "Concept presentation"] },
  { section: "Production", tasks: ["Dieline artwork", "Print proofing", "Press check"] },
];
const T_ONBOARD: Template = [
  { section: "Discovery", tasks: ["Funnel analysis", "KYC flow audit", "User interviews"] },
  { section: "Design", tasks: ["Onboarding wireframes", "Identity verification flow", "High-fidelity screens", "Prototype & test"] },
  { section: "Handoff", tasks: ["Developer handoff", "Design QA"] },
];
const T_INTERNAL_BRAND: Template = [{ section: "General", tasks: ["Brand refresh moodboard", "New wordmark", "Website art direction", "Case study template", "Deck template"] }];
const T_INTERNAL_PITCH: Template = [{ section: "General", tasks: ["Pitch deck system", "Credentials deck", "Proposal template", "Case study: Kirana", "Case study: Lumen"] }];
const RETAINER_REQUESTS = ["Instagram carousel", "Campaign key visual", "Landing page update", "Email newsletter", "Promo banner set", "Product photos retouch", "Feature announcement", "App store screenshots", "Blog illustrations"];

type ProjectSeed = {
  client: string | null;
  name: string;
  type: ContractType | null;
  currency: string;
  pm: string;
  members: string[];
  start: string;
  end: string | null;
  status: ProjectStatus;
  /** On hold from this date: no work, no invoices after it. */
  heldFrom?: string;
  template: Template | "retainer";
  /** Fixed: the contract value. Retainer: the monthly fee. T&M: the hourly rate. */
  value: number;
  /** Hours used ÷ budget at the end of the seed — sets the health state. */
  usage: number;
  /** Share of a person's project time this project tends to get. */
  weight?: number;
  links?: Record<string, string>;
};

const d = (n: number) => addDays(today, n);
const PROJECTS: ProjectSeed[] = [
  { client: "PINE", name: "Packaging Refresh", type: "fixed", currency: "IDR", pm: "bayu", members: ["sekar", "yoga"], start: nextWeekday(START), end: d(-305), status: "completed", template: T_PACK, value: 65_000_000, usage: 0.94 },
  { client: "BARA", name: "E-commerce Launch", type: "fixed", currency: "IDR", pm: "bayu", members: ["dimas", "sekar", "yoga"], start: d(-357), end: d(-248), status: "completed", template: T_WEB, value: 185_000_000, usage: 1.04 },
  { client: "LUMN", name: "Patient App UX", type: "fixed", currency: "SGD", pm: "putri", members: ["ana", "yoga"], start: d(-350), end: d(-206), status: "completed", template: T_APP, value: 38_000, usage: 0.97, links: { figma: "https://www.figma.com/file/lumen-patient-app" } },
  { client: null, name: "Odama Brand Refresh", type: null, currency: "IDR", pm: "putri", members: ["ana", "sekar"], start: d(-287), end: d(-172), status: "completed", template: T_INTERNAL_BRAND, value: 0, usage: 0, weight: 0.3 },
  { client: "NWND", name: "Marketing Site", type: "fixed", currency: "USD", pm: "putri", members: ["dimas", "ana"], start: d(-280), end: d(-143), status: "completed", template: T_WEB, value: 28_000, usage: 0.91, links: { figma: "https://www.figma.com/file/northwind-site", slack_channel: "#nwnd-site" } },
  { client: "KRNA", name: "Brand Identity", type: "fixed", currency: "IDR", pm: "bayu", members: ["ana", "sekar"], start: d(-259), end: d(-115), status: "completed", template: T_BRAND, value: 240_000_000, usage: 0.88 },
  { client: "BARA", name: "Social Retainer", type: "retainer", currency: "IDR", pm: "bayu", members: ["sekar", "dimas"], start: monthStart(d(-232)), end: null, status: "active", template: "retainer", value: 35_000_000, usage: 0.9, weight: 0.4, links: { slack_channel: "#bara-social" } },
  { client: "TIDE", name: "App Redesign", type: "time_and_material", currency: "AUD", pm: "putri", members: ["dimas"], start: d(-196), end: null, status: "on_hold", heldFrom: d(-45), template: T_APP, value: 140, usage: 0.71 },
  { client: "LUMN", name: "Design System", type: "time_and_material", currency: "SGD", pm: "putri", members: ["ana", "sekar"], start: d(-168), end: null, status: "active", template: T_SYSTEM, value: 150, usage: 0.62, weight: 0.7 },
  { client: "NWND", name: "Product Retainer", type: "retainer", currency: "USD", pm: "putri", members: ["dimas", "sekar"], start: monthStart(d(-140)), end: null, status: "active", template: "retainer", value: 6_500, usage: 0.95, weight: 0.5 },
  { client: null, name: "Pitch Templates", type: null, currency: "IDR", pm: "bayu", members: ["sekar", "raka"], start: d(-126), end: null, status: "active", template: T_INTERNAL_PITCH, value: 0, usage: 0, weight: 0.2 },
  { client: "KRNA", name: "Booking Website", type: "fixed", currency: "IDR", pm: "bayu", members: ["dimas", "sekar"], start: d(-105), end: d(60), status: "active", template: T_WEB, value: 320_000_000, usage: 0.79, links: { figma: "https://www.figma.com/file/kirana-booking", slack_channel: "#kirana-web" } },
  { client: "HALC", name: "Annual Report 2026", type: "fixed", currency: "EUR", pm: "putri", members: ["ana", "sekar"], start: d(-77), end: d(11), status: "active", template: T_REPORT, value: 14_000, usage: 1.13 },
  { client: "SGRA", name: "Onboarding Flow", type: "fixed", currency: "IDR", pm: "bayu", members: ["dimas", "sekar"], start: d(-42), end: d(39), status: "active", template: T_ONBOARD, value: 150_000_000, usage: 0.38 },
];

/** Month-start reference rates to IDR (oldest first); the seed's last month already has rates. */
const FX_PATH: Record<string, [number, number]> = { USD: [15_650, 16_300], EUR: [18_250, 17_800], SGD: [12_050, 12_600], AUD: [10_250, 10_700] };
const fxOn = (currency: string, iso: string) => {
  if (currency === "IDR") return 1;
  const [from, to] = FX_PATH[currency]!;
  const t = Math.min(1, Math.max(0, daysBetween(START, iso) / 365));
  return Math.round(from + (to - from) * t + Math.sin(t * 9) * from * 0.008);
};

// ---------------------------------------------------------------------------

async function main() {
  if (await prisma.client.findUnique({ where: { code: "LUMN" } })) {
    console.log("History is already seeded (client LUMN exists) — nothing to do.");
    return;
  }
  const profiles = await prisma.profile.findMany();
  if (profiles.length === 0) throw new Error("Run `pnpm db:seed` first — the history needs its people.");
  const byEmail = (e: string) => profiles.find((p) => p.email === e)?.id;
  const id: Record<string, string> = {
    rafi: profiles.find((p) => p.role === "c_level")!.id,
    putri: byEmail("putri@odama.io")!,
    bayu: byEmail("bayu@odama.io")!,
    ana: byEmail("ana@odama.io")!,
    dimas: byEmail("dimas@odama.io")!,
    sekar: byEmail("sekar@odama.io")!,
    raka: byEmail("raka@odama.io")!,
    lestari: byEmail("lestari@odama.io")!,
    nadia: byEmail("nadia@odama.io")!,
  };
  if (Object.values(id).some((v) => !v)) throw new Error("The base seed's people are missing — run `pnpm db:seed` on an empty database first.");

  // A freelancer who worked the first half of the year, then left.
  const yoga = await prisma.profile.create({
    data: { id: randomUUID(), email: "yoga@odama.io", fullName: "Yoga Pranata", role: "designer_dev", employmentType: "freelancer", status: "active", createdAt: at(START, 10) },
  });
  id.yoga = yoga.id;
  const yogaLeft = d(-170);
  const employment: Record<string, EmploymentType> = Object.fromEntries([...profiles, yoga].map((p) => [p.id, p.employmentType]));

  // --- Clients -------------------------------------------------------------
  const clientId: Record<string, string> = {};
  for (const [i, c] of CLIENTS.entries()) {
    const created = at(addDays(START, -20 + i * 30), 10);
    const row = await prisma.client.create({
      data: {
        code: c.code,
        name: c.name,
        country: c.country,
        timezone: c.timezone,
        defaultCurrency: c.currency,
        billingEmail: c.email,
        billingAddress: c.address,
        isArchived: Boolean(c.archived),
        createdBy: id.raka,
        createdAt: created,
        contacts: { create: [{ name: c.contact[0], email: c.contact[1], title: c.contact[2], isPrimary: true, createdAt: created }] },
      },
    });
    clientId[c.code] = row.id;
  }

  // --- Projects, members, sections, tasks ----------------------------------
  type TaskRow = { id: string; projectId: string; sectionId: string; title: string; ownerId: string | null; status: TaskStatus; due: string; from: string; done?: string };
  type Built = { seed: ProjectSeed; id: string; code: string; workEnd: string; tasks: TaskRow[]; pmTask: string };
  const built: Built[] = [];

  for (const p of PROJECTS) {
    const workEnd = [p.end ?? today, p.heldFrom ?? today, today].sort()[0]!;
    const project = await prisma.project.create({
      data: {
        name: p.name,
        kind: p.client ? "client" : "internal",
        clientId: p.client ? clientId[p.client] : null,
        contractType: p.type,
        currency: p.currency,
        pmId: id[p.pm]!,
        status: p.status,
        startDate: day(p.start),
        endDate: p.end ? day(p.end) : null,
        links: p.links ?? {},
        createdBy: p.client ? id.raka : id[p.pm],
        createdAt: at(addDays(p.start, -7), 10),
        updatedAt: at(p.status === "completed" ? p.end! : p.heldFrom ?? addDays(today, -between(1, 6)), 15),
        contract: p.client
          ? { create: p.type === "retainer" ? { contractValue: p.value * 12, retainerFeePerMonth: p.value } : p.type === "fixed" ? { contractValue: p.value } : {} }
          : undefined,
        budget: { create: { alertThresholds: p.type === "retainer" ? [50, 80, 100] : [75, 100] } },
      },
    });
    await prisma.projectMember.createMany({
      data: p.members.map((m) => ({ projectId: project.id, userId: id[m]!, addedBy: id[p.pm], createdAt: at(p.start, 9) })),
      skipDuplicates: true,
    });

    const general = await prisma.section.findFirstOrThrow({ where: { projectId: project.id } });
    const sections =
      p.template === "retainer"
        ? [{ section: "Monthly requests", tasks: [] as string[] }]
        : p.template;
    const sectionIds: string[] = [];
    for (const [i, s] of sections.entries()) {
      if (i === 0) {
        await prisma.section.update({ where: { id: general.id }, data: { name: s.section } });
        sectionIds.push(general.id);
      } else {
        sectionIds.push((await prisma.section.create({ data: { projectId: project.id, name: s.section, position: i } })).id);
      }
    }

    const designers = p.members.filter((m) => !["raka"].includes(m) && !(m === "yoga" && p.start > yogaLeft));
    const tasks: TaskRow[] = [];
    const statusFor = (due: string): TaskStatus => {
      if (p.status === "completed") return "done";
      if (p.heldFrom && due > p.heldFrom) return "todo";
      if (due < d(-6)) return chance(0.93) ? "done" : pick(["review", "in_progress"] as const);
      if (due <= today) return pick(["review", "in_progress", "done", "blocked", "in_progress"] as const);
      if (due <= d(14)) return pick(["in_progress", "todo", "in_progress"] as const);
      return "todo";
    };

    if (p.template === "retainer") {
      for (let m = monthStart(p.start); m <= monthStart(today); m = addMonths(m, 1)) {
        const n = between(3, 5);
        for (let i = 0; i < n; i++) {
          const due = nextWeekday(addDays(m, Math.round(((i + 1) / (n + 1)) * 27)));
          const status = statusFor(due);
          tasks.push({ id: randomUUID(), projectId: project.id, sectionId: sectionIds[0]!, title: `${pick(RETAINER_REQUESTS)} — ${monthName(m).split(" ")[0]}`, ownerId: id[designers[i % designers.length]!]!, status, due, from: addDays(due, -10) });
        }
      }
    } else {
      const span = Math.max(20, daysBetween(p.start, p.end ?? d(90)));
      const all = sections.flatMap((s, si) => s.tasks.map((title) => ({ title, sectionId: sectionIds[si]! })));
      const step = span / all.length;
      all.forEach((t, i) => {
        const due = nextWeekday(addDays(p.start, Math.round((i + 1) * step)));
        const owner = designers[(i + between(0, 1)) % designers.length]!;
        const ownerId = owner === "yoga" && due > yogaLeft ? id[designers.find((x) => x !== "yoga")!]! : id[owner]!;
        tasks.push({ id: randomUUID(), projectId: project.id, sectionId: t.sectionId, title: t.title, ownerId, status: statusFor(due), due, from: addDays(due, -Math.round(step * 1.6)) });
      });
    }
    // The PM's running coordination task; it closes with the project.
    const pmTask: TaskRow = {
      id: randomUUID(),
      projectId: project.id,
      sectionId: sectionIds[0]!,
      title: p.client ? "Project management & client calls" : "Coordination",
      ownerId: id[p.pm]!,
      status: p.status === "completed" ? "done" : "in_progress",
      due: p.end ?? addMonths(today, 2),
      from: p.start,
    };
    tasks.unshift(pmTask);
    for (const t of tasks) if (t.status === "done") t.done = [addDays(t.due, between(-3, 2)), today].sort()[0];

    await prisma.task.createMany({
      data: tasks.map((t, i) => ({
        id: t.id,
        projectId: t.projectId,
        sectionId: t.sectionId,
        title: t.title,
        ownerId: t.ownerId,
        status: t.status,
        priority: t === pmTask ? "normal" : pick(["normal", "normal", "normal", "high", "low", "urgent"] as const),
        dueDate: day(t.due),
        estimateHours: t === pmTask ? null : between(4, 24),
        position: (i + 1) * 1000,
        createdBy: id[p.pm],
        createdAt: at(t === pmTask ? p.start : addDays(t.from, -between(2, 10)) < p.start ? p.start : addDays(t.from, -between(2, 10)), 11),
        description: doc(t === pmTask ? "Weekly status, client calls and scope tracking." : `Brief for “${t.title}”. See the Figma file for references.`),
      })),
    });
    // Completion time follows the work, not the seed run.
    const done = tasks.filter((t) => t.done);
    if (done.length) {
      await prisma.$executeRaw`
        UPDATE public.tasks t SET completed_at = v.at
        FROM unnest(${done.map((t) => t.id)}::uuid[], ${done.map((t) => at(t.done!, 16).toISOString())}::timestamptz[]) AS v(id, at)
        WHERE t.id = v.id`;
    }
    await prisma.taskActivity.createMany({
      data: tasks.flatMap((t) => [
        { taskId: t.id, actorId: id[p.pm], type: "created", createdAt: at(t.from < p.start ? p.start : t.from, 11) },
        ...(t.status !== "todo" ? [{ taskId: t.id, actorId: t.ownerId, type: "status_changed", payload: { from: "todo", to: "in_progress" }, createdAt: at(t.from, 10) }] : []),
        ...(t.done ? [{ taskId: t.id, actorId: t.ownerId, type: "status_changed", payload: { from: "in_progress", to: "done" }, createdAt: at(t.done, 16) }] : []),
      ]),
    });

    built.push({ seed: p, id: project.id, code: project.code, workEnd, tasks, pmTask: pmTask.id });
  }

  // Collaborators and a few comments.
  const COMMENTS = [
    "Client feedback is in — two small copy changes, otherwise approved.",
    "Uploaded v2 to Figma. Can someone review before Thursday's call?",
    "Blocked on final assets from the client; chased again today.",
    "Moved the deadline by two days after the scope call.",
    "Looks great. Let's ship this one.",
    "Added notes from the workshop to the brief.",
  ];
  for (const b of built) {
    const memberIds = [id[b.seed.pm]!, ...b.seed.members.map((m) => id[m]!)];
    const collab = b.tasks.filter((t) => t.id !== b.pmTask && chance(0.25)).flatMap((t) => {
      const other = memberIds.find((m) => m !== t.ownerId && m !== id[b.seed.pm] && m !== id.yoga);
      return other ? [{ taskId: t.id, userId: other }] : [];
    });
    if (collab.length) await prisma.taskCollaborator.createMany({ data: collab, skipDuplicates: true });
    for (const t of b.tasks.filter((x) => x.id !== b.pmTask && x.status !== "todo" && chance(0.3))) {
      const authorId = chance(0.5) ? id[b.seed.pm]! : t.ownerId!;
      await prisma.taskComment.create({ data: { taskId: t.id, authorId, body: { text: pick(COMMENTS), mentions: [] }, createdAt: at(addDays(t.due, -between(1, 4)) > today ? today : addDays(t.due, -between(1, 4)), 14) } });
    }
  }

  // --- Leave -----------------------------------------------------------------
  const LEAVE: [string, number, number, string][] = [
    ["ana", -294, -290, "Year-end leave"],
    ["dimas", -208, -206, "Annual leave"],
    ["bayu", -182, -180, "Sick leave"],
    ["sekar", -119, -115, "Annual leave"],
    ["putri", -98, -94, "Annual leave"],
    ["nadia", -56, -52, "Annual leave"],
    ["dimas", -20, -20, "Sick leave"],
  ];
  await prisma.capacityOverride.createMany({
    data: LEAVE.map(([who, from, to, reason]) => ({ userId: id[who]!, periodStart: day(d(from)), periodEnd: day(d(to)), availableHours: 0, reason, createdBy: id.nadia, createdAt: at(d(from - 10), 10) })),
  });
  const onLeave = (who: string, iso: string) => LEAVE.some(([w, from, to]) => w === who && iso >= d(from) && iso <= d(to));

  // --- Time ------------------------------------------------------------------
  const categories = await prisma.workCategory.findMany();
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;
  const existing = await prisma.timeEntry.groupBy({ by: ["userId", "entryDate"], _sum: { minutes: true } });
  const logged = new Map(existing.map((e) => [`${e.userId}|${e.entryDate.toISOString().slice(0, 10)}`, e._sum.minutes ?? 0]));

  type Entry = Prisma.TimeEntryCreateManyInput;
  const entries: Entry[] = [];
  const add = (who: string, iso: string, minutes: number, target: { taskId?: string; categoryId?: string }, note?: string) =>
    entries.push({ id: randomUUID(), userId: id[who]!, entryDate: day(iso), minutes, ...target, note: note ?? null, createdAt: at(iso, between(16, 19)) });

  const dailyTarget: Record<EmploymentType, [number, number]> = { full_time: [390, 480], contract: [330, 390], freelancer: [210, 270] };
  const makers = ["ana", "dimas", "sekar", "yoga"];
  const OOS_NOTES = ["Client asked for an extra page variant", "Additional revision round requested on the call", "New stakeholder requested a different direction", "Extra export sizes for the campaign", "Rush request outside the agreed scope"];
  const oosCandidates: { entryId: string; projectIdx: number; iso: string }[] = [];

  for (let iso = START; iso < today; iso = addDays(iso, 1)) {
    if (isWeekend(iso) || HOLIDAYS.has(iso)) continue;
    const monday = day(iso).getUTCDay() === 1;
    const running = built.map((b, idx) => ({ b, idx })).filter(({ b }) => iso >= b.seed.start && iso <= b.workEnd);

    for (const who of ["ana", "dimas", "sekar", "yoga", "putri", "bayu", "raka", "rafi", "lestari", "nadia"]) {
      if (who === "yoga" && iso > yogaLeft) continue;
      if (onLeave(who, iso) || chance(0.03)) continue;
      const already = logged.get(`${id[who]}|${iso}`) ?? 0;
      const [lo, hi] = dailyTarget[employment[id[who]!]!];
      let left = between(lo, hi) - already;
      if (left < 45) continue;

      if (monday && who !== "lestari") {
        add(who, iso, 60, { categoryId: cat("Meeting internal") }, "Weekly studio sync");
        left -= 60;
      }

      if (makers.includes(who)) {
        const mine = running.filter(({ b }) => b.seed.members.includes(who));
        if (mine.length === 0) {
          add(who, iso, quarter(left * 0.6), { categoryId: cat(pick(["Riset", "Belajar"])) }, pick(["Exploring motion tools", "Type specimen research", "Portfolio refresh", "Learning Framer"]));
          add(who, iso, quarter(left * 0.4), { categoryId: cat("Admin") });
          continue;
        }
        if (chance(0.12)) {
          const m = quarter(between(30, 90));
          add(who, iso, m, { categoryId: cat(pick(["Riset", "Belajar", "Admin"])) });
          left -= m;
        }
        const weights = mine.map(({ b }) => (b.seed.weight ?? 1) * (0.6 + rand() * 0.8));
        const total = weights.reduce((s, w) => s + w, 0);
        mine.forEach(({ b, idx }, i) => {
          const minutes = quarter((left * weights[i]!) / total);
          if (minutes < 30) return;
          const own = b.tasks.filter((t) => t.id !== b.pmTask && t.ownerId === id[who] && iso >= t.from && iso <= t.due);
          const open = b.tasks.filter((t) => t.id !== b.pmTask && iso >= t.from && iso <= addDays(t.due, 3));
          const fallback = b.tasks.filter((t) => t.id !== b.pmTask).sort((x, y) => Math.abs(daysBetween(x.due, iso)) - Math.abs(daysBetween(y.due, iso)));
          const task = pick(own.length ? own : open.length ? open : fallback.slice(0, 2));
          if (!task) return;
          add(who, iso, minutes, { taskId: task.id });
          if (b.seed.client && iso < d(-3) && chance(0.025)) oosCandidates.push({ entryId: entries.at(-1)!.id!, projectIdx: idx, iso });
        });
      } else if (who === "putri" || who === "bayu") {
        const mine = running.filter(({ b }) => b.seed.pm === who);
        const pmShare = mine.length ? left * 0.75 : 0;
        for (const { b } of mine) {
          const m = quarter(pmShare / mine.length);
          if (m >= 30) add(who, iso, m, { taskId: b.pmTask }, chance(0.2) ? "Client call + notes" : undefined);
        }
        add(who, iso, quarter(left - pmShare), { categoryId: cat(chance(0.6) ? "Admin" : "Meeting internal") });
      } else if (who === "raka") {
        if (chance(0.55)) add(who, iso, quarter(between(90, 240)), { categoryId: cat("Pitching") }, pick(["Proposal for a hospitality lead", "Pitch deck — fintech lead", "Discovery call", "Credentials meeting"]));
        add(who, iso, quarter(between(60, 150)), { categoryId: cat("Admin") }, "CRM & follow-ups");
        const pitch = running.find(({ b }) => b.seed.name === "Pitch Templates");
        if (pitch && chance(0.3)) add(who, iso, 60, { taskId: pick(pitch.b.tasks.filter((t) => t.id !== pitch.b.pmTask)).id });
      } else if (who === "rafi") {
        if (chance(0.5)) add(who, iso, quarter(between(60, 180)), { categoryId: cat("Pitching") }, pick(["Pitch with Raka", "Partner meeting", "Lead review"]));
      } else if (who === "lestari") {
        if (chance(0.6)) add(who, iso, quarter(between(120, 240)), { categoryId: cat("Admin") }, pick(["Invoicing & reconciliation", "Payables", "Tax filing prep", "Monthly close"]));
      } else if (who === "nadia") {
        add(who, iso, quarter(between(180, 300)), { categoryId: cat("Admin") }, pick(["Payroll", "Hiring — interviews", "Contracts", "Onboarding docs"]));
      }
    }
  }

  // Out of scope: reviewed in the past, a few still waiting.
  const oos = new Map<string, Partial<Entry>>();
  for (const c of oosCandidates) {
    const recent = c.iso > d(-21);
    const status = recent && chance(0.6) ? "pending" : chance(0.75) ? "approved" : "rejected";
    const pm = id[built[c.projectIdx]!.seed.pm]!;
    oos.set(c.entryId, {
      note: pick(OOS_NOTES),
      oosStatus: status,
      ...(status !== "pending" ? { oosReviewedBy: pm, oosReviewedAt: at(addDays(c.iso, between(1, 3)), 10), oosNote: status === "rejected" ? "Part of the agreed revisions." : null } : {}),
      ...(status === "approved" && c.iso < d(-45) && chance(0.6) ? { billedAt: at(addDays(c.iso, 30), 10) } : {}),
    });
  }
  for (const e of entries) Object.assign(e, oos.get(e.id!) ?? {});
  for (let i = 0; i < entries.length; i += 1000) await prisma.timeEntry.createMany({ data: entries.slice(i, i + 1000) });

  // Every week before this one is locked.
  const thisMonday = addDays(today, -((day(today).getUTCDay() + 6) % 7));
  const weeks: string[] = [];
  for (let w = addDays(START, -((day(START).getUTCDay() + 6) % 7)); w < thisMonday; w = addDays(w, 7)) weeks.push(w);
  await prisma.timesheetLock.createMany({ data: weeks.map((w) => ({ weekStart: day(w), lockedAt: at(addDays(w, 8), 9) })), skipDuplicates: true });

  // Corrections on locked weeks: one waiting, one approved, one rejected.
  const anaEntries = entries.filter((e) => e.userId === id.ana && e.taskId);
  const pickEntry = (from: number, to: number) => anaEntries.find((e) => (e.entryDate as Date).toISOString().slice(0, 10) >= d(from) && (e.entryDate as Date).toISOString().slice(0, 10) <= d(to));
  for (const [from, to, status, reason] of [
    [-12, -8, "pending", "Logged 2h too little — the client workshop ran long."],
    [-40, -35, "approved", "Wrong task: this was the wireframes, not the visual direction."],
    [-70, -64, "rejected", "Forgot to log Friday afternoon."],
  ] as const) {
    const e = pickEntry(from, to);
    if (!e) continue;
    const created = addDays((e.entryDate as Date).toISOString().slice(0, 10), 9);
    await prisma.timeCorrection.create({
      data: {
        timeEntryId: e.id,
        requestedBy: id.ana,
        proposed: { entryDate: (e.entryDate as Date).toISOString().slice(0, 10), minutes: e.minutes + 120, taskId: e.taskId, categoryId: null, note: e.note ?? null },
        reason,
        status,
        createdAt: at(created, 11),
        ...(status !== "pending" ? { reviewedBy: id.putri, reviewedAt: at(addDays(created, 1), 10), reviewNote: status === "rejected" ? "Please log it as a separate entry next time." : null } : {}),
      },
    });
  }

  // --- Budgets from the hours that were actually logged -----------------------
  const hoursBy = new Map<string, number>();
  const monthHours = new Map<string, number>();
  for (const e of entries) {
    const b = built.find((x) => x.tasks.some((t) => t.id === e.taskId));
    if (!b) continue;
    hoursBy.set(b.id, (hoursBy.get(b.id) ?? 0) + e.minutes / 60);
    const m = `${b.id}|${monthStart((e.entryDate as Date).toISOString().slice(0, 10))}`;
    monthHours.set(m, (monthHours.get(m) ?? 0) + e.minutes / 60);
  }
  for (const b of built) {
    const p = b.seed;
    if (!p.client) continue;
    if (p.type === "retainer") {
      const months = [...monthHours.entries()].filter(([k]) => k.startsWith(b.id) && !k.endsWith(monthStart(today))).map(([, h]) => h);
      const avg = months.length ? months.reduce((s, h) => s + h, 0) / months.length : 30;
      const perMonth = Math.max(10, Math.round(avg / p.usage / 5) * 5);
      await prisma.projectBudget.update({ where: { projectId: b.id }, data: { retainerHoursPerMonth: perMonth, rolloverMode: "capped", rolloverCapHours: Math.round(perMonth / 4) } });
      // Freeze the settings of every past month (lib/health/queries.ts freezeRetainerMonths).
      const past: string[] = [];
      for (let m = monthStart(p.start); m < monthStart(today); m = addMonths(m, 1)) past.push(m);
      await prisma.retainerPeriod.createMany({
        data: past.map((m) => ({ projectId: b.id, month: day(m), hoursPerMonth: perMonth, rolloverMode: "capped" as const, rolloverCapHours: Math.round(perMonth / 4) })),
        skipDuplicates: true,
      });
    } else {
      const used = hoursBy.get(b.id) ?? 0;
      await prisma.projectBudget.update({ where: { projectId: b.id }, data: { budgetHours: Math.max(20, Math.round(used / p.usage / 5) * 5) } });
    }
  }

  // --- Invoices and payments --------------------------------------------------
  type Req = { label: string; share: number; due: string; paidOn: string | null };
  type InvoiceSeed = { b: Built; issue: string; items: { description: string; quantity: number; unitPrice: number }[]; requests: Req[]; voided?: boolean; note?: string };
  const invoices: InvoiceSeed[] = [];
  /** When the client pays: usually around the due date, sometimes late; never in the future. */
  const payDate = (due: string, client: string) => {
    const late = client === "TIDE" ? between(6, 25) : client === "KRNA" ? between(-2, 12) : between(-8, 6);
    const paid = nextWeekday(addDays(due, late));
    return paid < today ? paid : null;
  };
  const fixedDue = 14;

  for (const b of built) {
    const p = b.seed;
    if (!p.client) continue;
    if (p.type === "fixed") {
      const milestones: [string, number, string][] =
        p.value >= 150_000_000 || p.currency !== "IDR"
          ? [["Down payment (40%)", 0.4, p.start], ["Design milestone (30%)", 0.3, addDays(p.start, Math.round(daysBetween(p.start, p.end!) * 0.55))], ["Final payment (30%)", 0.3, p.end!]]
          : [["Down payment (50%)", 0.5, p.start], ["Final payment (50%)", 0.5, p.end!]];
      for (const [label, share, when] of milestones) {
        const issue = nextWeekday(when);
        if (issue >= today) continue;
        const due = addDays(issue, fixedDue);
        const amount = Math.round(p.value * share);
        // Halcyon pays its design milestone in two halves.
        const split = p.name === "Annual Report 2026" && label.startsWith("Design");
        invoices.push({
          b,
          issue,
          items: [{ description: `${p.name} — ${label.replace(/ \(.*/, "").toLowerCase()}`, quantity: 1, unitPrice: amount }],
          requests: split
            ? [
                { label: "First half", share: 0.5, due, paidOn: payDate(due, p.client) },
                { label: "Second half", share: 0.5, due: addDays(due, 30), paidOn: null },
              ]
            : [{ label: label.replace(/ \(.*/, ""), share: 1, due, paidOn: payDate(due, p.client) }],
        });
      }
    } else if (p.type === "retainer") {
      for (let m = monthStart(p.start); m <= monthStart(today); m = addMonths(m, 1)) {
        const issue = nextWeekday(m);
        if (issue >= today) continue;
        const due = addDays(issue, 14);
        invoices.push({ b, issue, items: [{ description: `${p.name} — ${monthName(m)}`, quantity: 1, unitPrice: p.value }], requests: [{ label: "Monthly fee", share: 1, due, paidOn: payDate(due, p.client) }] });
      }
    } else {
      // Time & materials: last month's billable hours, invoiced on the 3rd.
      for (let m = monthStart(p.start); m < monthStart(today); m = addMonths(m, 1)) {
        const hours = Math.round((monthHours.get(`${b.id}|${m}`) ?? 0) * 4) / 4;
        if (hours < 1) continue;
        const issue = nextWeekday(addDays(addMonths(m, 1), 2));
        if (issue >= today) continue;
        const due = addDays(issue, 30);
        invoices.push({ b, issue, items: [{ description: `${p.name} — design hours, ${monthName(m)}`, quantity: hours, unitPrice: p.value }], requests: [{ label: "Full payment", share: 1, due, paidOn: payDate(due, p.client) }] });
      }
    }
  }
  // The existing NUSA retainer: its past months, at the fee the base seed set.
  const nusa = await prisma.project.findFirst({ where: { code: "NUSA-001" }, include: { contract: true, client: true } });
  if (nusa?.client) {
    const fee = Number(nusa.contract?.retainerFeePerMonth ?? 60_000_000);
    const fake = { seed: { client: "NUSA", name: nusa.name, currency: nusa.currency } as ProjectSeed, id: nusa.id, code: nusa.code, workEnd: today, tasks: [], pmTask: "" } as Built;
    for (let m = monthStart(isoOf(nusa.startDate)); m <= monthStart(today); m = addMonths(m, 1)) {
      const issue = nextWeekday(m);
      if (issue >= today) continue;
      const due = addDays(issue, 14);
      invoices.push({ b: fake, issue, items: [{ description: `${nusa.name} — ${monthName(m)}`, quantity: 1, unitPrice: fee }], requests: [{ label: "Monthly fee", share: 1, due, paidOn: payDate(due, "NUSA") }] });
    }
  }
  // One invoice went out with the wrong amount and was voided, then reissued.
  const lumen = invoices.find((i) => i.b.seed.name === "Patient App UX");
  if (lumen) invoices.push({ ...lumen, items: lumen.items.map((it) => ({ ...it, unitPrice: it.unitPrice * 1.1 })), requests: lumen.requests.map((r) => ({ ...r, paidOn: null })), voided: true, issue: addDays(lumen.issue, -1) });

  invoices.sort((a, b) => a.issue.localeCompare(b.issue));
  const settings = await prisma.appSetting.findUnique({ where: { key: "invoice_number_format" } });
  const format = typeof settings?.value === "string" ? settings.value : "ODAMA/{YY}/{SEQ}";
  const clients = await prisma.client.findMany();
  const CHANNELS_IDR = ["BCA", "MANDIRI", "BNI", "BRI", "QRIS"] as const;
  const activity: Prisma.ActivityLogCreateManyInput[] = [];
  let paymentCount = 0;

  for (const inv of invoices) {
    const p = inv.b.seed;
    const client = clients.find((c) => c.code === (p.client ?? ""))!;
    const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT app.next_invoice_number(${Number(inv.issue.slice(0, 4))}::int) AS n`;
    const year = Number(inv.issue.slice(0, 4));
    const number = format.replace("{YYYY}", String(year)).replace("{YY}", String(year % 100).padStart(2, "0")).replace("{SEQ}", String(row!.n).padStart(4, "0"));
    const minor = p.currency === "IDR" ? 1 : 100;
    const items = inv.items.map((it, i) => ({ ...it, amount: Math.round(it.quantity * it.unitPrice * minor) / minor, position: i }));
    const total = items.reduce((s, it) => s + it.amount, 0);
    const reqs = inv.requests.map((r, i) => ({ ...r, amount: i === inv.requests.length - 1 ? 0 : Math.round(total * r.share * minor) / minor, position: i }));
    reqs[reqs.length - 1]!.amount = Math.round((total - reqs.slice(0, -1).reduce((s, r) => s + r.amount, 0)) * minor) / minor;
    const paid = inv.voided ? 0 : reqs.filter((r) => r.paidOn).reduce((s, r) => s + r.amount, 0);
    const overdue = reqs.some((r) => !r.paidOn && r.due < today);
    const status = inv.voided ? "void" : paid >= total ? "paid" : overdue ? "overdue" : paid > 0 ? "partially_paid" : "sent";
    const sentAt = at(inv.issue, 10);

    const invoice = await prisma.invoice.create({
      data: {
        number,
        projectId: inv.b.id,
        clientId: client.id,
        currency: p.currency,
        issueDate: day(inv.issue),
        status,
        notes: "Thank you for working with Odama.",
        billToName: client.name,
        billToAddress: client.billingAddress,
        billToEmail: client.billingEmail,
        subtotal: total,
        total,
        amountPaid: paid,
        sentAt,
        voidedAt: inv.voided ? at(addDays(inv.issue, 1), 11) : null,
        overdueNotifiedAt: status === "overdue" ? at(addDays(reqs.find((r) => !r.paidOn && r.due < today)!.due, 1), 9) : null,
        createdBy: id.lestari,
        createdAt: at(addDays(inv.issue, -1), 15),
        items: { create: items.map((it) => ({ description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, amount: it.amount, position: it.position })) },
        deliveries: {
          create: [{ toEmails: [client.billingEmail!], ccEmails: ["finance@odama.io"], subject: `Invoice ${number} from Odama Studio`, sentBy: id.lestari, sentAt, status: "sent", resendMessageId: `seed_${randomUUID()}` }],
        },
      },
    });
    activity.push({ actorId: id.lestari, entityType: "invoice", entityId: invoice.id, action: "created", createdAt: at(addDays(inv.issue, -1), 15) });
    activity.push({ actorId: id.lestari, entityType: "invoice", entityId: invoice.id, action: "sent", metadata: { to: [client.billingEmail] }, createdAt: sentAt });
    if (inv.voided) activity.push({ actorId: id.lestari, entityType: "invoice", entityId: invoice.id, action: "voided", createdAt: at(addDays(inv.issue, 1), 11) });

    for (const r of reqs) {
      const requestId = randomUUID();
      const reqStatus = inv.voided ? "void" : r.paidOn ? "paid" : "pending";
      const paidAt = r.paidOn ? new Date(at(r.paidOn, between(9, 20)).getTime() + between(0, 59) * 60_000) : null;
      await prisma.invoicePaymentRequest.create({
        data: {
          id: requestId,
          invoiceId: invoice.id,
          label: r.label,
          amount: r.amount,
          dueDate: day(r.due),
          position: r.position,
          status: reqStatus,
          xenditInvoiceId: `seed_inv_${requestId.slice(0, 13)}`,
          xenditUrl: `https://checkout-staging.xendit.co/web/seed_${requestId.slice(0, 13)}`,
          xenditExpiresAt: at(addDays(r.due, 60), 23),
          paidAt,
          createdAt: sentAt,
        },
      });
      if (!r.paidOn || !paidAt || inv.voided) continue;
      const idr = p.currency === "IDR";
      const channel = idr ? pick(CHANNELS_IDR) : "CREDIT_CARD";
      const fee = idr ? (channel === "QRIS" ? Math.round(r.amount * 0.007) : 4_440) : Math.round(r.amount * 0.029 * 100) / 100;
      const rate = fxOn(p.currency, r.paidOn) * (idr ? 1 : 0.996);
      const settlement = idr ? r.amount - fee : Math.round((r.amount - fee) * rate);
      const externalId = `seed_pay_${randomUUID()}`;
      await prisma.payment.create({
        data: {
          paymentRequestId: requestId,
          invoiceId: invoice.id,
          externalId,
          amount: r.amount,
          currency: p.currency,
          paidAt,
          channel,
          feeAmount: fee,
          netAmount: r.amount - fee,
          settlementAmountIdr: settlement,
          fxRateToIdr: idr ? 1 : Math.round((settlement / r.amount) * 1_000_000) / 1_000_000,
          raw: { id: `seed_inv_${requestId.slice(0, 13)}`, payment_id: externalId, external_id: requestId, status: "PAID", amount: r.amount, paid_amount: r.amount, currency: p.currency, payment_channel: channel, fees_paid_amount: fee, paid_at: paidAt.toISOString(), ...(idr ? {} : { settlement_currency: "IDR", settlement_amount: settlement }) },
          matchedAt: paidAt,
          createdAt: paidAt,
        },
      });
      paymentCount++;
    }
  }

  // Project and client records in the audit trail.
  for (const b of built) activity.push({ actorId: b.seed.client ? id.raka : id[b.seed.pm], entityType: "project", entityId: b.id, action: "created", metadata: { code: b.code }, createdAt: at(addDays(b.seed.start, -7), 10) });
  for (const [code, cid] of Object.entries(clientId)) activity.push({ actorId: id.raka, entityType: "client", entityId: cid, action: "created", metadata: { code }, createdAt: at(addDays(START, -20 + Object.keys(clientId).indexOf(code) * 30), 10) });
  await prisma.activityLog.createMany({ data: activity });

  // --- Expenses -----------------------------------------------------------------
  const have = new Set((await prisma.expense.findMany({ select: { vendor: true, expenseDate: true } })).map((e) => `${e.vendor}|${isoOf(e.expenseDate).slice(0, 7)}`));
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const spend = (iso: string, vendor: string, description: string, category: Prisma.ExpenseCreateManyInput["category"], kind: "opex" | "capex", amount: number, currency: string, projectId?: string) => {
    if (iso >= today || iso < START || have.has(`${vendor}|${iso.slice(0, 7)}`)) return;
    expenses.push({ expenseDate: day(iso), vendor, description, category, kind, amount, currency, projectId: projectId ?? null, createdBy: id.lestari, createdAt: at(addDays(iso, between(0, 3)), 11) });
  };
  for (let m = monthStart(START); m <= monthStart(today); m = addMonths(m, 1)) {
    const afterRenewal = m >= "2026-01-01";
    spend(addDays(m, 0), "Office rent", "Studio space", "rent", "opex", afterRenewal ? 13_500_000 : 12_000_000, "IDR");
    spend(addDays(m, 2), "PLN", "Electricity · studio", "utilities", "opex", between(10, 14) * 100_000 + between(0, 9) * 10_000, "IDR");
    spend(addDays(m, 4), "Biznet", "Fiber internet 300 Mbps", "internet", "opex", 650_000, "IDR");
    spend(addDays(m, 3), "Figma", m >= "2026-03-01" ? "Professional plan, 4 seats" : "Professional plan, 3 seats", "software", "opex", m >= "2026-03-01" ? 60 : 45, "USD");
    spend(addDays(m, 6), "Google Workspace", "Business Standard, 9 users", "software", "opex", 129.6, "USD");
    spend(addDays(m, 9), "Adobe", "Creative Cloud for teams, 2 seats", "software", "opex", 2_150_000, "IDR");
    spend(addDays(m, 11), "Notion", "Plus plan", "software", "opex", 50, "USD");
    spend(addDays(m, 14), "Slack", "Pro plan", "software", "opex", 78.75, "USD");
    spend(addDays(m, 19), "Gojek", "Couriers & client meeting rides", "travel", "opex", between(4, 9) * 100_000, "IDR");
    if ([0, 3, 6, 9].includes(day(m).getUTCMonth())) spend(addDays(m, 24), "KAP Wijaya & Rekan", "Quarterly bookkeeping & tax", "professional_services", "opex", 4_500_000, "IDR");
  }
  const P = (name: string) => built.find((b) => b.seed.name === name)?.id;
  spend(d(-340), "Singapore Airlines", "Kickoff trip — Lumen Health", "travel", "opex", 7_850_000, "IDR", P("Patient App UX"));
  spend(d(-338), "Hotel G Singapore", "3 nights · kickoff workshop", "travel", "opex", 780, "SGD", P("Patient App UX"));
  spend(d(-300), "Meta", "Instagram ads — studio launch", "marketing", "opex", 3_500_000, "IDR");
  spend(d(-262), "LG Store", "27\" 4K monitor for Dimas", "equipment", "capex", 8_499_000, "IDR");
  spend(d(-230), "Studio Lensa", "Product photography · Kirana brand", "professional_services", "opex", 18_000_000, "IDR", P("Brand Identity"));
  spend(d(-205), "Wacom", "Intuos Pro tablet", "equipment", "capex", 6_250_000, "IDR");
  spend(d(-190), "Monotype", "Font licence · Kirana brand", "software", "opex", 640, "USD", P("Brand Identity"));
  spend(d(-150), "Awwwards", "Conference tickets · Amsterdam", "marketing", "opex", 1_190, "EUR");
  spend(d(-110), "IKEA", "Studio chairs (4)", "equipment", "capex", 11_960_000, "IDR");
  spend(d(-95), "Meta", "LinkedIn & Instagram ads — case studies", "marketing", "opex", 5_000_000, "IDR");
  spend(d(-60), "Rina Putri (freelance)", "Copywriting · annual report", "professional_services", "opex", 12_000_000, "IDR", P("Annual Report 2026"));
  spend(d(-33), "Garuda Indonesia", "Site visit · Kirana Bali", "travel", "opex", 4_320_000, "IDR", P("Booking Website"));
  spend(d(-12), "Percetakan Sinar", "Printed proofs · annual report", "other", "opex", 2_750_000, "IDR", P("Annual Report 2026"));
  await prisma.expense.createMany({ data: expenses });

  // --- Costs, capacity, targets, FX ---------------------------------------------
  const costStart = day(monthStart(START));
  await prisma.personCost.createMany({
    data: [
      { userId: id.yoga, effectiveFrom: costStart, monthlyCostIdr: 9_600_000, notes: "Freelance day rate × expected days", createdBy: id.nadia },
      { userId: id.ana, effectiveFrom: day("2026-04-01"), monthlyCostIdr: 17_920_000, notes: "Annual review: +12%", createdBy: id.nadia },
      { userId: id.putri, effectiveFrom: day("2026-04-01"), monthlyCostIdr: 24_200_000, notes: "Annual review: +10%", createdBy: id.nadia },
      { userId: id.dimas, effectiveFrom: day("2026-07-01"), monthlyCostIdr: 17_500_000, notes: "Contract renewal", createdBy: id.nadia },
    ],
    skipDuplicates: true,
  });
  await prisma.personCapacity.createMany({ data: [{ userId: id.yoga, effectiveFrom: costStart, weeklyHours: 20, createdBy: id.nadia }], skipDuplicates: true });
  await prisma.profile.update({ where: { id: id.yoga }, data: { status: "deactivated", deactivatedAt: at(yogaLeft, 18) } });

  const targets: Prisma.RevenueTargetCreateManyInput[] = [{ year: Number(START.slice(0, 4)), month: null, targetIdr: 2_000_000_000, createdBy: id.rafi }];
  for (let m = monthStart(START); m <= addMonths(today, 2); m = addMonths(m, 1)) {
    const year = Number(m.slice(0, 4));
    targets.push({ year, month: Number(m.slice(5, 7)), targetIdr: year < 2026 ? 170_000_000 : 200_000_000, createdBy: id.rafi });
  }
  await prisma.revenueTarget.createMany({ data: targets, skipDuplicates: true });

  const fx: Prisma.FxReferenceRateCreateManyInput[] = [];
  for (let m = monthStart(START); m < monthStart(today); m = addMonths(m, 1)) {
    for (const c of Object.keys(FX_PATH)) fx.push({ currency: c, rateToIdr: fxOn(c, m), effectiveFrom: day(m), updatedBy: id.lestari });
  }
  await prisma.fxReferenceRate.createMany({ data: fx, skipDuplicates: true });

  console.log(
    `Seeded a year of history: ${CLIENTS.length} clients, ${built.length} projects, ${built.reduce((s, b) => s + b.tasks.length, 0)} tasks, ` +
      `${entries.length} time entries, ${invoices.length} invoices, ${paymentCount} payments, ${expenses.length} expenses.`,
  );
}

function isoOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
