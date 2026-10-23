/**
 * Demo pipeline (Phase 2 · M9) for local development: deals across the
 * stages with a stage history over the last five months, and daily pipeline
 * snapshots rebuilt from that history so the Sales report has candles.
 * Real data never gets backfilled snapshots — the job records them from go-live.
 * Runs once: it does nothing when deals already exist.
 *
 *   pnpm db:seed:sales
 */
import { PrismaClient, type StageCategory } from "@prisma/client";

const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

// title, company, value, currency, path of [stage, days ago entered], source, service
const DEALS: [string, string, number, string, [string, number][], string, string, string?][] = [
  ["Brand refresh", "Kopi Senja", 180_000_000, "IDR", [["Lead", 150], ["Qualified", 132], ["Proposal sent", 118], ["Won", 101]], "Referral", "Branding"],
  ["Marketing site", "Nusantara Bank", 420_000_000, "IDR", [["Lead", 140], ["Qualified", 120], ["Proposal sent", 95], ["Negotiation", 70], ["Won", 52]], "Inbound", "Website"],
  ["Mobile app MVP", "Halo Klinik", 38_000, "USD", [["Lead", 128], ["Qualified", 110], ["Proposal sent", 84], ["Lost", 60]], "Dribbble", "Product", "Chose an in-house team"],
  ["Design system", "Tokopedia Seller", 260_000_000, "IDR", [["Lead", 100], ["Qualified", 88], ["Proposal sent", 61], ["Negotiation", 33]], "Referral", "Product"],
  ["E-commerce rebuild", "Batik Lestari", 310_000_000, "IDR", [["Lead", 92], ["Qualified", 70], ["Proposal sent", 40]], "Awwwards", "Website"],
  ["Pitch deck", "Arunika Ventures", 45_000_000, "IDR", [["Lead", 80], ["Qualified", 74], ["Won", 63]], "Referral", "Branding"],
  ["SaaS dashboard", "Ledgerly", 24_000, "USD", [["Lead", 75], ["Qualified", 52], ["Proposal sent", 30], ["Negotiation", 9]], "Upwork", "Product"],
  ["Packaging", "Teh Kita", 95_000_000, "IDR", [["Lead", 66], ["Lost", 41]], "Inbound", "Branding", "Budget moved to next year"],
  ["Annual report", "Yayasan Cerah", 70_000_000, "IDR", [["Lead", 58], ["Qualified", 45]], "Referral", "Editorial"],
  ["Website care retainer", "Kopi Senja", 15_000_000, "IDR", [["Lead", 40], ["Qualified", 36], ["Proposal sent", 30], ["Won", 18]], "Existing client", "Retainer"],
  ["Rebrand", "Sinar Logistics", 16_000, "EUR", [["Lead", 34], ["Qualified", 20]], "Inbound", "Branding"],
  ["Booking flow", "Pulau Resorts", 210_000_000, "IDR", [["Lead", 25], ["Qualified", 12], ["Proposal sent", 4]], "Dribbble", "Product"],
  ["Landing pages", "Gudang Kreatif", 60_000_000, "IDR", [["Lead", 14]], "Inbound", "Website"],
  ["Illustration set", "Bacaan Anak", 35_000_000, "IDR", [["Lead", 6]], "Instagram", "Illustration"],
  ["Investor site", "Arunika Ventures", 120_000_000, "IDR", [["Lead", 21], ["Lost", 3]], "Referral", "Website", "No response after proposal"],
];

const RATES: Record<string, number> = { IDR: 1, USD: 16_300, EUR: 17_600 };

export async function seedSales(prisma: PrismaClient) {
  if ((await prisma.deal.count()) > 0) return console.log("Sales: deals exist, skipped.");
  const stages = await prisma.pipelineStage.findMany();
  const stage = (name: string) => stages.find((s) => s.name === name)!;
  const owner = await prisma.profile.findFirst({ where: { role: "sales", status: "active" }, select: { id: true } });
  const clients = await prisma.client.findMany({ select: { id: true, name: true } });

  type Move = { on: number; category: StageCategory; probability: number; idr: number; deal: number };
  const moves: Move[] = [];
  for (const [i, [title, company, value, currency, path, source, service, lostReason]] of DEALS.entries()) {
    const client = clients.find((c) => c.name === company);
    const [first] = path;
    const last = path.at(-1)!;
    const end = stage(last[0]);
    const deal = await prisma.deal.create({
      data: {
        title,
        clientId: client?.id ?? null,
        prospectName: client ? null : company,
        value,
        currency,
        probability: stage(first![0]).probability,
        stageId: stage(first![0]).id,
        ownerId: owner?.id ?? null,
        leadSource: source,
        serviceType: service,
        expectedClose: end.category === "open" ? new Date(Date.UTC(2026, 10 + (i % 3), 5 + i)) : null,
        createdAt: at(first![1]),
      },
    });
    // Later stages: the trigger stamps now(); move the history and the deal back in time.
    for (const [name] of path.slice(1)) {
      await prisma.deal.update({ where: { id: deal.id }, data: { stageId: stage(name).id, ...(name === "Lost" ? { lostReason: lostReason ?? "Lost" } : {}) } });
    }
    const history = await prisma.dealStageHistory.findMany({ where: { dealId: deal.id }, orderBy: { changedAt: "asc" } });
    for (const [j, h] of history.entries()) await prisma.dealStageHistory.update({ where: { id: h.id }, data: { changedAt: at(path[j]![1]) } });
    await prisma.deal.update({ where: { id: deal.id }, data: { stageChangedAt: at(last[1]), ...(end.category !== "open" ? { closedAt: at(last[1]) } : {}) } });
    for (const [name, daysAgo] of path) {
      const s = stage(name);
      moves.push({ on: daysAgo, category: s.category, probability: s.probability, idr: value * RATES[currency]!, deal: i });
    }
  }

  // Snapshots for the last 150 days, as the daily job would have recorded them.
  for (let d = 150; d >= 1; d--) {
    const state = new Map<number, Move>();
    for (const m of [...moves].sort((a, b) => b.on - a.on)) if (m.on >= d) state.set(m.deal, m);
    const open = [...state.values()].filter((m) => m.category === "open");
    const date = new Date(`${new Date(Date.now() - d * DAY + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);
    const data = {
      openIdr: open.reduce((s, m) => s + m.idr, 0),
      weightedIdr: Math.round(open.reduce((s, m) => s + (m.idr * m.probability) / 100, 0)),
      openCount: open.length,
    };
    await prisma.pipelineSnapshot.upsert({ where: { date }, create: { date, ...data }, update: data });
  }
  console.log(`Sales: ${DEALS.length} deals, 150 days of snapshots.`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedSales(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
