import "server-only";
import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ATTENTION_RULES } from "@/lib/clevel/pure";

export const DEFAULT_CLEVEL_THRESHOLDS = { good: 100, watch: 80, concentration: 40, utilizationBand: 15 };

const rule = (value: number) =>
  z.object({ enabled: z.boolean().catch(true), value: z.number().min(0).max(10_000).catch(value) }).catch({ enabled: true, value });

/**
 * App settings (M0.5) — key/value rows in `app_settings`, parsed with defaults
 * so a missing or malformed row never breaks a screen. Everyone may read
 * them (RLS); only admins write (app/(app)/settings/actions.ts).
 */
export const settingsSchema = z.object({
  reminder_time: z.string().regex(/^\d{2}:\d{2}$/).catch("17:00"),
  /** ISO weekdays, Monday = 1 … Sunday = 7. */
  workdays: z.array(z.number().int().min(1).max(7)).catch([1, 2, 3, 4, 5]),
  timezone: z.string().catch("Asia/Jakarta"),
  default_alert_thresholds: z.array(z.number().int().min(1).max(500)).catch([75, 100]),
  currencies: z.array(z.string().length(3)).catch(["IDR", "USD", "EUR", "SGD", "AUD"]),
  base_currency: z.string().length(3).catch("IDR"),
  invoice_number_format: z.string().catch("ODAMA/{YY}/{SEQ}"),
  invoice_sender_email: z.string().catch("finance@odama.io"),
  invoice_sender_name: z.string().catch("Odama Studio"),
  studio_profile: z
    .object({
      name: z.string().catch("Odama Studio"),
      address: z.string().catch(""),
      email: z.string().catch(""),
      website: z.string().catch(""),
    })
    .catch({ name: "Odama Studio", address: "", email: "", website: "" }),
  /** C-Level dashboard §3.8 — when an active project needs attention. C-Level and admins write it. */
  project_attention_rules: z
    .object({
      budgetPct: rule(100),
      overdueTasks: rule(3),
      lateInvoiceDays: rule(14),
      marginPct: rule(20),
    })
    .catch(DEFAULT_ATTENTION_RULES),
  /** C-Level dashboard §2.4, §4.4, §6.3 — status thresholds. */
  clevel_dashboard_thresholds: z
    .object({
      good: z.number().min(0).max(1000).catch(100),
      watch: z.number().min(0).max(1000).catch(80),
      concentration: z.number().min(0).max(100).catch(40),
      utilizationBand: z.number().min(0).max(100).catch(15),
    })
    .catch(DEFAULT_CLEVEL_THRESHOLDS),
});

export type AppSettings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof AppSettings;

export const getSettings = cache(async (): Promise<AppSettings> => {
  const rows = await prisma.appSetting.findMany();
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return settingsSchema.parse(raw);
});
