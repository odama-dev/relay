"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { asUser, requireUser } from "@/lib/auth";
import { run, fail, parseOrFail, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { categorySchema, settingsFormSchema, uuid } from "@/lib/validation";
import { linkSlack } from "@/lib/people/accounts";
import { notify } from "@/lib/notify";
import { slackConfigured } from "@/lib/env";
import { executeImport, previewImport, type ImportRowResult } from "@/lib/import/run";
import { sendInvitation } from "@/lib/people/accounts";
import type { ImportKind } from "@/lib/import/templates";
import type { ImportMode } from "@/lib/import/validate";
import { z } from "zod";

async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) fail("Only an admin can change settings.");
  return user;
}

/** M0.5 — written under RLS: app_settings only accepts admins. */
export async function saveSettings(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireAdmin();
    const d = parseOrFail(settingsFormSchema, raw);
    if (!d.currencies.includes(d.base_currency)) fail("The base currency must be one of the active currencies.");
    const entries: [string, Prisma.InputJsonValue][] = [
      ["reminder_time", d.reminder_time],
      ["workdays", [...new Set(d.workdays)].sort()],
      ["default_alert_thresholds", [...new Set(d.default_alert_thresholds)].sort((a, b) => a - b)],
      ["sales_stale_days", d.sales_stale_days],
      ["currencies", d.currencies],
      ["base_currency", d.base_currency],
      ["invoice_number_format", d.invoice_number_format],
      ["invoice_sender_email", d.invoice_sender_email],
      ["invoice_sender_name", d.invoice_sender_name],
      ["studio_profile", { name: d.studio_name, address: d.studio_address, email: d.studio_email, website: d.studio_website }],
    ];
    await asUser(user, async (tx) => {
      for (const [key, value] of entries) {
        await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
    });
    await logActivity({ actorId: user.id, entityType: "settings", entityId: "app", action: "updated" });
    revalidatePath("/settings");
  });
}

// --- M3.2 work categories ----------------------------------------------------

export async function addCategory(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireAdmin();
    const { name } = parseOrFail(categorySchema, raw);
    await asUser(user, async (tx) => {
      const last = await tx.workCategory.aggregate({ _max: { position: true } });
      await tx.workCategory.create({ data: { name, position: (last._max.position ?? -1) + 1 } });
    });
    revalidatePath("/settings");
  });
}

export async function renameCategory(id: unknown, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireAdmin();
    const { name } = parseOrFail(categorySchema, raw);
    await asUser(user, (tx) => tx.workCategory.update({ where: { id: parseOrFail(uuid, id) }, data: { name } }));
    revalidatePath("/settings");
  });
}

export async function moveCategory(id: unknown, direction: "up" | "down"): Promise<ActionResult> {
  return run(async () => {
    const user = await requireAdmin();
    const categoryId = parseOrFail(uuid, id);
    await asUser(user, async (tx) => {
      const all = await tx.workCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] });
      const i = all.findIndex((c) => c.id === categoryId);
      const j = direction === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= all.length) return;
      [all[i], all[j]] = [all[j]!, all[i]!];
      for (const [position, c] of all.entries()) {
        if (c.position !== position) await tx.workCategory.update({ where: { id: c.id }, data: { position } });
      }
    });
    revalidatePath("/settings");
  });
}

export async function setCategoryActive(id: unknown, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requireAdmin();
    await asUser(user, (tx) => tx.workCategory.update({ where: { id: parseOrFail(uuid, id) }, data: { isActive: active } }));
    revalidatePath("/settings");
  });
}

/** A category that was ever used can only be deactivated (M3.2). */
export async function deleteCategory(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await requireAdmin();
    const categoryId = parseOrFail(uuid, id);
    const used = await prisma.timeEntry.count({ where: { categoryId } });
    if (used > 0) fail("This category has logged time. Deactivate it instead.");
    await asUser(user, (tx) => tx.workCategory.delete({ where: { id: categoryId } }));
    revalidatePath("/settings");
  });
}

// --- M0.6 Slack ----------------------------------------------------------------

/** Retries the email lookup for every active user not linked yet. */
export async function relinkSlack(): Promise<ActionResult<{ linked: number; missing: number }>> {
  return run(async () => {
    await requireAdmin();
    if (!slackConfigured) fail("Slack isn't configured (SLACK_BOT_TOKEN).");
    const unlinked = await prisma.profile.findMany({ where: { status: "active", slackUserId: null }, select: { id: true } });
    let linked = 0;
    for (const p of unlinked) if ((await linkSlack(p.id)).linked) linked++;
    revalidatePath("/settings");
    return { linked, missing: unlinked.length - linked };
  });
}

/** DoD M0: one test DM to every linked user. */
export async function sendSlackTest(id?: unknown): Promise<ActionResult<{ sent: number; failed: number }>> {
  return run(async () => {
    const user = await requireAdmin();
    if (!slackConfigured) fail("Slack isn't configured (SLACK_BOT_TOKEN).");
    const targets = await prisma.profile.findMany({
      where: { status: "active", slackUserId: { not: null }, ...(id ? { id: parseOrFail(uuid, id) } : {}) },
      select: { id: true },
    });
    let sent = 0;
    for (const t of targets) {
      const res = await notify(t.id, "slack_test", {
        title: "Odama OS is connected to Slack",
        body: `Test message sent by ${user.fullName}. Work notifications will arrive here.`,
        path: "/profile",
      });
      if (res.delivered === "slack" && !res.error) sent++;
    }
    return { sent, failed: targets.length - sent };
  });
}

// --- CSV import (users → clients → projects) ------------------------------------

const importInput = z.object({
  kind: z.enum(["users", "clients", "projects"]),
  text: z.string().max(5_000_000, "The file is too large."),
  mode: z.enum(["skip", "update"]),
});

export async function previewCsv(raw: unknown): Promise<ActionResult<{ rows: ImportRowResult[] }>> {
  return run(async () => {
    await requireAdmin();
    const { kind, text, mode } = parseOrFail(importInput, raw);
    const res = await previewImport(kind as ImportKind, text, mode as ImportMode);
    if ("error" in res) fail(res.error);
    return res;
  });
}

export async function runCsvImport(raw: unknown): Promise<ActionResult<{ rows: ImportRowResult[] }>> {
  return run(async () => {
    const user = await requireAdmin();
    const { kind, text, mode } = parseOrFail(importInput, raw);
    const res = await executeImport(kind as ImportKind, text, mode as ImportMode, user.id);
    if ("error" in res) fail(res.error);
    const done = res.rows.filter((r) => r.action === "created" || r.action === "updated").length;
    await logActivity({ actorId: user.id, entityType: "import", entityId: kind, action: "imported", metadata: { mode, rows: res.rows.length, done } });
    revalidatePath("/", "layout");
    return res;
  });
}

/** Imported users stay `invited` until the admin sends their invitations. */
export async function sendPendingInvites(): Promise<ActionResult<{ sent: number; failed: number }>> {
  return run(async () => {
    const user = await requireAdmin();
    const pending = await prisma.profile.findMany({
      where: { status: "invited", invitations: { none: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } } },
      select: { id: true },
    });
    let sent = 0;
    for (const p of pending) if ((await sendInvitation(p.id, user.id)).emailed) sent++;
    revalidatePath("/people");
    return { sent, failed: pending.length - sent };
  });
}
