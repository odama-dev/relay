import "server-only";
import { asUser, type CurrentUser } from "@/lib/auth";

export const SEARCH_MIN_CHARS = 2;

export type SearchGroup = "Projects" | "Tasks" | "Clients" | "People" | "Invoices";
export type SearchHit = { group: SearchGroup; id: string; title: string; subtitle?: string; href: string };

/**
 * ⌘K search. Runs under RLS, so it only ever finds what the user may open —
 * no per-role filtering here.
 */
export async function search(user: CurrentUser, raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < SEARCH_MIN_CHARS) return [];
  const contains = { contains: q, mode: "insensitive" as const };

  return asUser(user, async (tx) => {
    const [projects, tasks, clients, people, invoices] = await Promise.all([
      tx.project.findMany({
        where: { OR: [{ name: contains }, { code: contains }] },
        select: { id: true, code: true, name: true, client: { select: { name: true } } },
        take: 6,
      }),
      tx.task.findMany({
        where: { title: contains },
        select: { id: true, title: true, projectId: true, project: { select: { code: true } } },
        take: 6,
      }),
      tx.client.findMany({
        where: { OR: [{ name: contains }, { code: contains }] },
        select: { id: true, code: true, name: true },
        take: 5,
      }),
      tx.profile.findMany({
        where: { status: { not: "deactivated" }, OR: [{ fullName: contains }, { email: contains }] },
        select: { id: true, fullName: true, email: true },
        take: 5,
      }),
      tx.invoice.findMany({
        where: { OR: [{ number: contains }, { billToName: contains }] },
        select: { id: true, number: true, billToName: true },
        take: 5,
      }),
    ]);

    return [
      ...projects.map((p) => ({
        group: "Projects" as const,
        id: p.id,
        title: `${p.code} · ${p.name}`,
        subtitle: p.client?.name ?? "Internal",
        href: `/projects/${p.id}`,
      })),
      ...tasks.map((t) => ({
        group: "Tasks" as const,
        id: t.id,
        title: t.title,
        subtitle: t.project.code,
        href: `/projects/${t.projectId}?task=${t.id}`,
      })),
      ...clients.map((c) => ({ group: "Clients" as const, id: c.id, title: c.name, subtitle: c.code, href: `/clients/${c.id}` })),
      ...people.map((p) => ({ group: "People" as const, id: p.id, title: p.fullName, subtitle: p.email, href: `/people?q=${encodeURIComponent(p.fullName)}` })),
      ...invoices.map((i) => ({
        group: "Invoices" as const,
        id: i.id,
        title: i.number ?? "Draft invoice",
        subtitle: i.billToName,
        href: `/invoices/${i.id}`,
      })),
    ];
  });
}
