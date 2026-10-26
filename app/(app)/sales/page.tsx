import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { CLOSED_WINDOW_DAYS, loadPipeline, parsePipelineFilters } from "@/lib/sales/queries";
import { clientOptions } from "@/lib/projects/queries";
import { activePeopleOptions } from "@/lib/people/queries";
import { crmOptions } from "@/lib/crm/queries";
import { SummaryStrip } from "@/components/summary-strip";
import { FilterBar } from "@/components/filter-bar";
import { PeriodFilter } from "@/components/period-filter";
import { PipelineView } from "./pipeline-view";

export const metadata = { title: "Pipeline" };

/** Phase 2 · M9 — the Sales pipeline (replaces Attio). Sales module edits; Studio Report reads. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAccess(perms.viewPipeline);
  const filters = parsePipelineFilters(await searchParams);
  const [data, clients, people, pms, settings, crm] = await Promise.all([
    loadPipeline(user, filters),
    perms.viewClients(user) ? clientOptions(user) : Promise.resolve([]),
    activePeopleOptions(user),
    activePeopleOptions(user, ["pm", "c_level"]),
    getSettings(),
    crmOptions(user),
  ]);
  const c = data.cards;
  const idr = (v: number) => formatMoney(v, "IDR", { compact: true });

  return (
    <PipelineView
      deals={data.deals}
      choices={{
        stages: data.stages,
        crmPeople: crm.people,
        crmCompanies: crm.companies,
        clients,
        people: people.map((p) => ({ id: p.id, name: p.name })),
        pms,
        canManage: perms.manageDeals(user),
        canCreateProject: perms.createProjects(user) && perms.manageDeals(user),
        canAddClient: perms.editClients(user),
        canEditContract: perms.editContractValue(user),
        thresholds: settings.default_alert_thresholds,
        defaultPmId: user.role === "pm" ? user.id : "",
        today: data.today,
        userId: user.id,
      }}
      header={
        <SummaryStrip
          items={[
            { label: "Total pipeline", values: [idr(c.openIdr)] },
            { label: "Weighted pipeline", values: [idr(c.weightedIdr)] },
            { label: filters.from || filters.to ? "Win rate · period" : `Win rate · ${CLOSED_WINDOW_DAYS} days`, values: c.winRate.rate === null ? [] : [`${c.winRate.rate}%`] },
            { label: "Avg. deal length", values: c.avgDays === null ? [] : [`${c.avgDays} days`] },
            { label: "New leads this month", values: [c.newLeads] },
            {
              label: "Overdue invoices",
              values: [c.overdueInvoices],
              tone: c.overdueInvoices ? "destructive" : "default",
            },
            ...(c.stale ? [{ label: `Stale · over ${data.staleDays} days`, values: [c.stale] }] : []),
          ]}
        />
      }
      filters={
        <FilterBar
          variant="bare"
          searchPlaceholder="Search deal, client, service or source"
          filters={[
            { param: "owner", label: "Owner", allLabel: "All owners", options: data.owners.map((o) => ({ value: o.id, label: o.name })) },
          ]}
          actions={<PeriodFilter from={filters.from} to={filters.to} label="Deal period" placeholder="Open · won & lost last 30 days" />}
        />
      }
    />
  );
}
