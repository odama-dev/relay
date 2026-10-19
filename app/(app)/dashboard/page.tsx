import type { ComponentType } from "react";
import type { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { perms, roleLabel } from "@/lib/roles";
import { dashboardPhase2 } from "@/lib/env";
import { dashboardContext, type DashboardContext } from "@/lib/dashboard/queries";
import { greeting } from "@/lib/dashboard/pure";
import { formatDateLong } from "@/lib/format";
import { timeIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import { DashboardCard, DashboardGrid, type CardSpan } from "@/components/dashboard-card";
import { TaskPanel } from "@/components/tasks/task-panel";
import { DueTasksCard, MonthSummaryCard, RecentCommentsCard, WeekHoursCard } from "./designer-dev";
import { ApprovalQueueCard, MyProjectHealthCard, ProjectBillingCard, TasksAtRiskCard } from "./pm";
import { ClevelDashboard } from "./clevel/clevel-dashboard";
import { ComplianceCard, HrCorrectionsCard, TasksPerPersonCard, TeamCompositionCard } from "./hr";
import { DueAndLateCard, IncomingPaymentsCard, OutstandingByClientCard, UnmatchedPaymentsCard } from "./finance";
import { ActiveClientsCard, DraftInvoicesCard, MyInvoicesCard, UninvoicedProjectsCard } from "./sales";

export const metadata = { title: "Dashboard" };

type Card = ComponentType<{ ctx: DashboardContext }>;

/**
 * Phase 1 cards per role, in display order: what needs action first, then the
 * numbers (PRD/OVERVIEW-SPEC.md §8). `is_admin` doesn't change the set (§1.1).
 */
const CARDS: Record<Exclude<UserRole, "c_level">, Card[]> = {
  designer_dev: [DueTasksCard, WeekHoursCard, RecentCommentsCard, MonthSummaryCard],
  pm: [ApprovalQueueCard, MyProjectHealthCard, TasksAtRiskCard, ProjectBillingCard],
  hr: [ComplianceCard, HrCorrectionsCard, TasksPerPersonCard, TeamCompositionCard],
  finance: [UnmatchedPaymentsCard, IncomingPaymentsCard, DueAndLateCard, OutstandingByClientCard],
  sales: [DraftInvoicesCard, MyInvoicesCard, ActiveClientsCard, UninvoicedProjectsCard],
};

/** Phase 2 slots, shown empty behind the `dashboard_phase2` flag (§1.5). */
const PHASE2: Record<UserRole, { title: string; span: CardSpan }[]> = {
  designer_dev: [
    { title: "Workload this week", span: "narrow" },
    { title: "KPI progress", span: "narrow" },
  ],
  pm: [{ title: "Team capacity this week", span: "narrow" }],
  c_level: [{ title: "Pipeline from Attio", span: "narrow" }],
  hr: [
    { title: "KPI / OKR cycle", span: "narrow" },
    { title: "Workload per person", span: "narrow" },
  ],
  finance: [{ title: "Month so far", span: "narrow" }],
  sales: [
    { title: "Won deals without a project", span: "narrow" },
    { title: "Team capacity", span: "narrow" },
  ],
};

/** The home screen after sign-in: one dashboard per role. C-Level has its own (PRD/Clevel dashboard.md). */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role === "c_level") {
    return (
      <>
        <ClevelDashboard user={user} searchParams={await searchParams} />
        {dashboardPhase2 && <Phase2 role="c_level" />}
      </>
    );
  }
  const ctx = dashboardContext(user);
  const firstName = user.fullName.split(" ")[0] || user.fullName;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        title={`${greeting(timeIn(user.timezone))}, ${firstName}`}
        description={`${formatDateLong(ctx.today)} · ${roleLabel(user.role)}`}
        actions={<RefreshButton />}
        className="mb-0"
      />
      <DashboardGrid>
        {CARDS[user.role].map((CardSlot, i) => (
          <CardSlot key={i} ctx={ctx} />
        ))}
      </DashboardGrid>
      {dashboardPhase2 && <Phase2 role={user.role} />}
      {perms.viewTasks(user) && <TaskPanel />}
    </div>
  );
}

function Phase2({ role }: { role: UserRole }) {
  return (
    <section aria-label="Coming in Phase 2" className="mt-4 flex flex-col gap-2">
      <h2 className="text-muted-foreground text-caption">Coming in Phase 2</h2>
      <DashboardGrid>
        {PHASE2[role].map((c) => (
          <DashboardCard key={c.title} title={c.title} span={c.span} phase2 />
        ))}
      </DashboardGrid>
    </section>
  );
}
