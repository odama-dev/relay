import { requireAccess, asUser } from "@/lib/auth";
import { perms, roleLabel } from "@/lib/roles";
import { numOr0 } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { addDays, isoDate, parseIsoDate, todayIn } from "@/lib/time/pure";
import { effectiveAt } from "@/lib/clevel/pure";
import { PageHeader } from "@/components/page-header";
import { EntityTabs, type EntityTab } from "@/components/entity-tabs";
import { CapacityPanel, CostsPanel, FxPanel, HistoryPanel, RevenuePanel, RulesPanel, UtilizationPanel } from "./panels";

export const metadata = { title: "Business Data" };

const HISTORY_TYPES = ["person_cost", "person_capacity", "capacity_override", "utilization_targets", "utilization_override", "revenue_targets", "fx_reference_rate", "dashboard_rules"];

/**
 * Inputs behind the C-Level dashboard (PRD/Clevel dashboard.md §7). Each tab
 * shows only to the roles that may read it; the database (RLS) enforces the
 * same rules. Operating expenses live on the Expenses page.
 */
export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ tab?: string; year?: string }> }) {
  const user = await requireAccess(perms.viewBusinessData);
  const { tab, year: yearParam } = await searchParams;
  const today = todayIn(user.timezone);
  const currentYear = Number(today.slice(0, 4));
  const year = Number(yearParam) >= 2000 && Number(yearParam) <= 2100 ? Number(yearParam) : currentYear;
  const settings = await getSettings();

  const can = {
    costs: perms.manageCosts(user),
    capacity: perms.viewCapacity(user),
    editCapacity: perms.manageCapacity(user),
    targets: perms.viewUtilizationTargets(user),
    editTargets: perms.manageUtilizationTargets(user),
    revenue: perms.manageRevenueTargets(user),
    fx: perms.manageFxRates(user),
    rules: perms.manageDashboardRules(user),
    history: user.isAdmin || user.role === "c_level",
  };

  const data = await asUser(user, async (tx) => ({
    people: await tx.profile.findMany({ where: { status: "active" }, select: { id: true, fullName: true, role: true, employmentType: true }, orderBy: { fullName: "asc" } }),
    costs: can.costs ? await tx.personCost.findMany({ orderBy: [{ effectiveFrom: "desc" }] }) : [],
    capacity: can.capacity ? await tx.personCapacity.findMany({ orderBy: [{ effectiveFrom: "desc" }] }) : [],
    overrides: can.capacity ? await tx.capacityOverride.findMany({ where: { periodEnd: { gte: parseIsoDate(addDays(today, -90)) } }, orderBy: { periodStart: "desc" } }) : [],
    roleTargets: can.targets ? await tx.utilizationTarget.findMany() : [],
    personTargets: can.targets ? await tx.utilizationOverride.findMany() : [],
    revenue: can.revenue ? await tx.revenueTarget.findMany({ where: { year } }) : [],
    fx: can.fx ? await tx.fxReferenceRate.findMany({ orderBy: [{ currency: "asc" }, { effectiveFrom: "desc" }] }) : [],
    history: can.history
      ? await tx.activityLog.findMany({ where: { entityType: { in: HISTORY_TYPES } }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { fullName: true } } } })
      : [],
  }));

  const name = new Map(data.people.map((p) => [p.id, p.fullName]));
  const people = data.people.map((p) => ({ id: p.id, name: p.fullName, role: p.role, roleLabel: roleLabel(p.role), employment: p.employmentType }));

  const items: EntityTab[] = [];
  if (can.costs) {
    const rows = data.costs.map((c) => ({ id: c.id, userId: c.userId, person: name.get(c.userId) ?? "Former member", effectiveFrom: isoDate(c.effectiveFrom), amount: numOr0(c.monthlyCostIdr), notes: c.notes }));
    const current = people.map((p) => {
      const mine = rows.filter((r) => r.userId === p.id);
      return { ...p, current: effectiveAt(mine, today)?.amount ?? null };
    });
    items.push({ value: "costs", label: "People costs", count: current.filter((p) => p.current === null).length || undefined, content: <CostsPanel people={current} rows={rows} today={today} /> });
  }
  if (can.capacity) {
    const rows = data.capacity.map((c) => ({ id: c.id, userId: c.userId, person: name.get(c.userId) ?? "Former member", effectiveFrom: isoDate(c.effectiveFrom), weeklyHours: numOr0(c.weeklyHours) }));
    const current = people
      .filter((p) => p.role !== "c_level")
      .map((p) => ({ ...p, current: effectiveAt(rows.filter((r) => r.userId === p.id), today)?.weeklyHours ?? null }));
    const overrides = data.overrides.map((o) => ({ id: o.id, person: name.get(o.userId) ?? "Former member", start: isoDate(o.periodStart), end: isoDate(o.periodEnd), hours: numOr0(o.availableHours), reason: o.reason }));
    items.push({
      value: "capacity",
      label: "Capacity",
      count: current.filter((p) => p.current === null).length || undefined,
      content: <CapacityPanel people={current} rows={rows} overrides={overrides} today={today} canEdit={can.editCapacity} />,
    });
  }
  if (can.targets) {
    const roles = (["designer_dev", "pm", "sales", "finance", "hr"] as const).map((r) => ({ role: r, label: roleLabel(r), target: numOr0(data.roleTargets.find((t) => t.role === r)?.targetPercent) }));
    const overrides = data.personTargets.map((t) => ({ userId: t.userId, person: name.get(t.userId) ?? "Former member", target: numOr0(t.targetPercent) }));
    items.push({
      value: "utilization",
      label: "Utilization targets",
      content: <UtilizationPanel roles={roles} overrides={overrides} people={people.filter((p) => p.role !== "c_level")} canEdit={can.editTargets} />,
    });
  }
  if (can.revenue) {
    const yearly = data.revenue.find((r) => r.month === null);
    const months = Array.from({ length: 12 }, (_, i) => {
      const r = data.revenue.find((x) => x.month === i + 1);
      return r ? numOr0(r.targetIdr) : null;
    });
    items.push({
      value: "revenue",
      label: "Revenue targets",
      content: <RevenuePanel key={year} year={year} years={[currentYear - 1, currentYear, currentYear + 1]} yearly={yearly ? numOr0(yearly.targetIdr) : null} months={months} />,
    });
  }
  if (can.fx) {
    const rows = data.fx.map((r) => ({ id: r.id, currency: r.currency, rate: numOr0(r.rateToIdr), effectiveFrom: isoDate(r.effectiveFrom) }));
    items.push({ value: "fx", label: "FX reference rates", content: <FxPanel rows={rows} today={today} currencies={settings.currencies.filter((c) => c !== "IDR")} /> });
  }
  if (can.rules) {
    items.push({ value: "rules", label: "Dashboard rules", content: <RulesPanel rules={settings.project_attention_rules} thresholds={settings.clevel_dashboard_thresholds} /> });
  }
  if (can.history) {
    const rows = data.history.map((h) => ({ id: h.id, at: h.createdAt.toISOString(), actor: h.actor?.fullName ?? "System", type: h.entityType, action: h.action, metadata: (h.metadata as Record<string, unknown> | null) ?? null, person: name.get(String((h.metadata as { userId?: string } | null)?.userId ?? "")) ?? null }));
    items.push({ value: "history", label: "Change history", content: <HistoryPanel rows={rows} timezone={user.timezone} /> });
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Business Data"
        description="Costs, capacity, targets and rates behind the C-Level dashboard. Operating costs are recorded under Expenses; retainer fees on each project."
      />
      <EntityTabs initial={tab} items={items} />
    </div>
  );
}
