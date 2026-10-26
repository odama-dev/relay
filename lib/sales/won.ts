import "server-only";
import type { Tx } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/actions";
import { perms, type Viewer } from "@/lib/roles";
import { parseIsoDate, type IsoDate } from "@/lib/time/pure";
import { clientCodeCandidates } from "@/lib/sales/pure";

export type WonProject = { id: string; code: string; clientId: string; clientCode: string; clientCreated: boolean };

/**
 * A won deal becomes a client and an Active project in the same write, so
 * it can be invoiced straight away. Runs inside the caller's RLS
 * transaction. The client is the deal's, its company's, or the client with
 * the prospect's name; otherwise it's added with a code from the name
 * (editable later). The project starts today as fixed price with the deal's
 * value as contract value; PM is the deal owner when they can lead
 * projects, else the person moving the deal, else the first C-Level.
 * Returns null when the deal isn't won or already has a project.
 */
export async function projectForWonDeal(
  tx: Tx,
  viewer: Viewer,
  dealId: string,
  opts: { today: IsoDate; thresholds: number[] },
): Promise<WonProject | null> {
  const deal = await tx.deal.findUnique({
    where: { id: dealId },
    select: {
      title: true,
      prospectName: true,
      value: true,
      currency: true,
      ownerId: true,
      projectId: true,
      clientId: true,
      companyId: true,
      company: { select: { name: true, clientId: true } },
      stage: { select: { category: true } },
    },
  });
  if (!deal || deal.stage.category !== "won" || deal.projectId) return null;

  const name = (deal.prospectName ?? deal.company?.name ?? deal.title).trim();
  let clientId = deal.clientId ?? deal.company?.clientId ?? null;
  let clientCreated = false;
  if (!clientId) {
    const same = await tx.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    clientId = same?.id ?? null;
  }
  if (!clientId) {
    const candidates = clientCodeCandidates(name);
    const taken = new Set((await tx.client.findMany({ where: { code: { in: candidates } }, select: { code: true } })).map((c) => c.code));
    const code = candidates.find((c) => !taken.has(c));
    if (!code) fail(`No free client code for ${name}. Add the client in Clients first.`);
    const client = await tx.client.create({ data: { code, name, defaultCurrency: deal.currency, createdBy: viewer.id } });
    clientId = client.id;
    clientCreated = true;
  }
  const client = await tx.client.findUnique({ where: { id: clientId }, select: { isArchived: true, name: true, code: true } });
  if (!client) fail("Client not found.");
  if (client.isArchived) fail(`${client.name} is archived. Restore it in Clients first.`);

  // The deal's company now stands for this client (one company per client).
  if (deal.companyId && !deal.company?.clientId && !(await tx.crmCompany.findUnique({ where: { clientId }, select: { id: true } }))) {
    await tx.crmCompany.update({ where: { id: deal.companyId }, data: { clientId } });
  }

  const pmId = await pickPm([deal.ownerId, viewer.id]);
  const project = await tx.project.create({
    data: {
      name: deal.title,
      kind: "client",
      clientId,
      contractType: "fixed",
      currency: deal.currency,
      pmId,
      status: "active",
      startDate: parseIsoDate(opts.today),
      links: { notion: "", figma: "", drive: "", slack_channel: "" },
      createdBy: viewer.id,
    },
    select: { id: true, code: true },
  });
  await tx.projectBudget.create({
    data: { projectId: project.id, budgetHours: null, rolloverMode: "none", alertThresholds: [...new Set(opts.thresholds)].sort((a, b) => a - b) },
  });
  if (perms.editContractValue(viewer)) {
    await tx.projectContract.create({ data: { projectId: project.id, contractValue: deal.value } });
  }
  await tx.deal.update({ where: { id: dealId }, data: { projectId: project.id, clientId, prospectName: null } });
  return { ...project, clientId, clientCode: client.code, clientCreated };
}

/** The first active Project Manager / C-Level among `preferred`, else the first active C-Level, else PM. */
async function pickPm(preferred: (string | null)[]): Promise<string> {
  const leads = await prisma.profile.findMany({
    where: { status: "active", role: { in: ["pm", "c_level"] } },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
    select: { id: true, role: true },
  });
  const pm = preferred.map((id) => leads.find((l) => l.id === id)).find(Boolean) ?? leads.find((l) => l.role === "c_level") ?? leads[0];
  if (!pm) fail("Add an active Project Manager or C-Level first — every project needs a PM.");
  return pm.id;
}
