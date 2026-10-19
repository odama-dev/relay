import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { slackConfigured, resendConfigured, xenditConfigured } from "@/lib/env";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { SettingsForm } from "./settings-form";
import { CategoriesPanel } from "./categories-panel";
import { SlackPanel } from "./slack-panel";
import { ImportPanel } from "./import-panel";
import { JobsPanel } from "./jobs-panel";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAccess(perms.manageSettings);
  const [settings, categories, usage, unlinked, linkedCount, jobs, { tab }] = await Promise.all([
    getSettings(),
    prisma.workCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    prisma.timeEntry.groupBy({ by: ["categoryId"], where: { categoryId: { not: null } }, _count: { _all: true } }),
    prisma.profile.findMany({
      where: { status: "active", slackUserId: null },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.profile.count({ where: { status: "active", slackUserId: { not: null } } }),
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    searchParams,
  ]);
  const used = new Map(usage.map((u) => [u.categoryId, u._count._all]));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Settings" description="Defaults used across Odama OS. Only admins can change them." />
      <EntityTabs
        initial={tab}
        items={[
          {
            value: "general",
            label: "General",
            content: (
              <SettingsForm
                initial={{
                  reminder_time: settings.reminder_time,
                  workdays: settings.workdays,
                  default_alert_thresholds: settings.default_alert_thresholds,
                  currencies: settings.currencies as ("IDR" | "USD" | "EUR" | "SGD" | "AUD")[],
                  base_currency: settings.base_currency as "IDR",
                  invoice_number_format: settings.invoice_number_format,
                  invoice_sender_email: settings.invoice_sender_email,
                  invoice_sender_name: settings.invoice_sender_name,
                  studio_name: settings.studio_profile.name,
                  studio_address: settings.studio_profile.address,
                  studio_email: settings.studio_profile.email,
                  studio_website: settings.studio_profile.website,
                }}
                integrations={{ slack: slackConfigured, resend: resendConfigured, xendit: xenditConfigured }}
              />
            ),
          },
          {
            value: "categories",
            label: "Work categories",
            count: categories.length,
            content: (
              <CategoriesPanel
                categories={categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, usage: used.get(c.id) ?? 0 }))}
              />
            ),
          },
          {
            value: "slack",
            label: "Slack",
            count: unlinked.length || undefined,
            content: <SlackPanel configured={slackConfigured} unlinked={unlinked} linkedCount={linkedCount} />,
          },
          { value: "import", label: "Import CSV", content: <ImportPanel /> },
          {
            value: "jobs",
            label: "Scheduled jobs",
            content: (
              <JobsPanel
                runs={jobs.map((j) => ({
                  id: j.id,
                  job: j.job,
                  startedAt: j.startedAt,
                  finishedAt: j.finishedAt,
                  ok: j.ok,
                  result: j.result ? JSON.stringify(j.result) : null,
                }))}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
