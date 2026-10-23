import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import type { DashboardContext } from "@/lib/dashboard/queries";
import {
  loadLeaveConflicts,
  loadAgingWidget,
  loadMyKpiCard,
  loadMyOkr,
  loadPipelineWidget,
  loadProofQueue,
  loadReviewQueue,
  loadStudioOkr,
  loadTeamWorkload,
  loadUpcomingObligations,
  widgetContext,
  type WidgetContext,
} from "@/lib/dashboard/phase2";
import { GRADES } from "@/lib/kpi/pure";
import { formatDateShort, formatHoursValue, formatMoney } from "@/lib/format";
import { MoneyText } from "@/components/money-text";
import { OBLIGATION_KIND_LABELS } from "@/lib/finance/obligations";
import { CardFigure, CardList, DashboardCard, DashboardGrid, cardRowClass } from "@/components/dashboard-card";
import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { defineCard } from "./card";
import { TaskRowButton } from "./widgets";
import { LeaveConflictRow } from "./leave-conflict-row";

const progressTone = (p: number | null) => (p === null ? "muted" : p >= 70 ? "success" : p >= 40 ? "warning" : "destructive");

/** "KPI saya": the month so far and — for task owners — Task on Time per week, achieved or not. */
export const MyKpiCard = defineCard({ id: "P2-KPI", title: "My KPI", span: "narrow" }, (ctx) => loadMyKpiCard(ctx.user), (d, _ctx, meta) => {
  const grade = GRADES.find((g) => g.grade === d.kpi.grade);
  return (
    <DashboardCard {...meta} action={{ label: "Details", href: "/kpi" }} isEmpty={!d.kpi.hasKpi} emptyText="You don't have a KPI yet. KPIs are set by HR." emptyIcon="target">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <CardFigure label="Month so far" value={d.kpi.score === null ? "—" : Math.round(d.kpi.score)} hint={d.kpi.calibration ? "Calibration" : undefined} />
          <CardFigure label="Grade" value={grade ? grade.grade : "—"} hint={grade?.label} />
        </div>
        {d.weeks.length > 0 && (
          <CardList>
            {d.weeks.map((w) => (
              <li key={w.start} className={cn(cardRowClass, "justify-between")}>
                <span className="text-muted-foreground tabular">Week of {formatDateShort(w.start)}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{w.actual === null ? "—" : `${Math.round(w.actual)}%`}</span>
                  {w.achieved !== null && <StatusBadge value={w.achieved ? "approved" : "overdue"} label={w.achieved ? "Achieved" : "Not achieved"} />}
                </span>
              </li>
            ))}
          </CardList>
        )}
        <p className="text-muted-foreground text-caption">Task on Time per week · target {d.target}%</p>
      </div>
    </DashboardCard>
  );
});

/** Reviewer: tasks waiting for you, with the SLA countdown. */
export const ReviewQueueCard = defineCard({ id: "P2-REVIEW", title: "Waiting for your review", span: "wide" }, (ctx) => loadReviewQueue(ctx.user), (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} countTone={rows.some((r) => r.hoursLeft < 0) ? "critical" : "warning"} isEmpty={!rows.length} emptyText="Nothing to review." emptyIcon="approvals">
    <CardList>
      {rows.slice(0, 8).map((r) => (
        <TaskRowButton
          key={r.taskId}
          taskId={r.taskId}
          trailing={
            <span className={cn("tabular shrink-0 text-caption", r.hoursLeft < 0 ? "text-destructive" : r.hoursLeft < 8 ? "text-warning" : "text-muted-foreground")}>
              {r.hoursLeft < 0 ? `${Math.abs(r.hoursLeft)}h past SLA` : `${r.hoursLeft}h left`}
            </span>
          }
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate">
              <span className="text-muted-foreground tabular">{r.projectCode}</span> · {r.title}
            </span>
            <span className="text-muted-foreground truncate text-caption">{r.owner ?? "No owner"}</span>
          </span>
        </TaskRowButton>
      ))}
    </CardList>
  </DashboardCard>
));

/** PM: tasks due while their owner is on leave. */
export const LeaveConflictsCard = defineCard({ id: "P2-LEAVE", title: "Leave vs tasks", span: "wide" }, (ctx) => loadLeaveConflicts(ctx.user), (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} countTone="warning" isEmpty={!rows.length} emptyText="No task falls due while its owner is away." emptyIcon="calendar">
    <CardList>
      {rows.slice(0, 8).map((c) => (
        <LeaveConflictRow key={c.taskId} c={c} />
      ))}
    </CardList>
  </DashboardCard>
));

/** Manager: workload this week for the people reporting to you. */
export const TeamWorkloadCard = defineCard({ id: "P2-WORKLOAD", title: "Team workload", span: "narrow" }, (ctx) => loadTeamWorkload(ctx.user), (rows, _ctx, meta) => (
  <DashboardCard {...meta} isEmpty={!rows.length} emptyText="Nobody reports to you yet." emptyIcon="people">
    <CardList>
      {rows.slice(0, 8).map((r) => (
        <li key={r.id} className={cn(cardRowClass, "justify-between")} title={`Workload, not utilization: ${formatHoursValue(r.plannedHours)} planned of ${formatHoursValue(r.capacityHours)}`}>
          <span className="truncate">
            {r.name}
            {r.away && <span className="text-muted-foreground"> · away</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <ProgressBar value={Math.min(100, r.pct ?? 0)} tone={r.pct === null ? "muted" : r.pct > 100 ? "destructive" : r.fromOverdue ? "warning" : "brand"} className="h-1.5 w-16" />
            <span className="tabular w-10 text-right">{r.pct === null ? "—" : `${r.pct}%`}</span>
          </span>
        </li>
      ))}
    </CardList>
    <p className="text-muted-foreground text-caption">Planned hours ÷ capacity this week</p>
  </DashboardCard>
));

function ObjectiveList({ rows }: { rows: { id: string; title: string; progress: number | null; due: number }[] }) {
  return (
    <CardList>
      {rows.slice(0, 6).map((o) => (
        <li key={o.id}>
          <Link href="/okr" className={cn(cardRowClass, "justify-between")}>
            <span className="truncate">{o.title}</span>
            <span className="flex shrink-0 items-center gap-2">
              {o.due > 0 && <span className="text-warning text-caption">{o.due} check-in{o.due === 1 ? "" : "s"} due</span>}
              <ProgressBar value={o.progress ?? 0} tone={progressTone(o.progress)} className="h-1.5 w-16" />
              <span className="tabular w-10 text-right">{o.progress === null ? "—" : `${o.progress}%`}</span>
            </span>
          </Link>
        </li>
      ))}
    </CardList>
  );
}

/** OKR owners: progress and this month's check-ins. */
export const MyOkrCard = defineCard({ id: "P2-OKR", title: "My OKR", span: "narrow" }, (ctx) => loadMyOkr(ctx.user), (d, _ctx, meta) => (
  <DashboardCard {...meta} action={{ label: "OKR", href: "/okr" }} isEmpty={!d.objectives.length} emptyText="No objectives this quarter." emptyIcon="target">
    <ObjectiveList
      rows={d.objectives.map((o) => ({ id: o.id, title: o.title, progress: o.progress, due: o.keyResults.filter((k) => (k.source === "manual" || k.kind === "milestone") && !k.checkedInThisMonth).length }))}
    />
  </DashboardCard>
));

/** Studio Report (C-Level): the studio's objectives this quarter. */
export const StudioOkrCard = defineCard({ id: "P2-STUDIO-OKR", title: "Studio OKR", span: "wide" }, (ctx) => loadStudioOkr(ctx.user), (d, _ctx, meta) => (
  <DashboardCard {...meta} action={{ label: "OKR", href: "/okr?tab=studio" }} isEmpty={!d.objectives.length} emptyText="No studio objectives for this quarter yet." emptyIcon="target">
    <ObjectiveList rows={d.objectives.map((o) => ({ id: o.id, title: o.title, progress: o.progress, due: 0 }))} />
  </DashboardCard>
));

/** Sales module: pipeline figures and the open deals that are stale or close soon. */
export const PipelineCard = defineCard({ id: "P2-PIPELINE", title: "Pipeline", span: "wide" }, (ctx) => loadPipelineWidget(ctx.user), (d, _ctx, meta) => (
  <DashboardCard {...meta} action={{ label: "Pipeline", href: "/sales" }}>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <CardFigure label="Open" value={formatMoney(d.cards.openIdr, "IDR", { compact: true })} hint={`${d.cards.openCount} deals`} />
      <CardFigure label="Weighted" value={formatMoney(d.cards.weightedIdr, "IDR", { compact: true })} />
      <CardFigure label="Win rate · 90 days" value={d.cards.winRate.rate === null ? "—" : `${d.cards.winRate.rate}%`} />
      <CardFigure label="Overdue invoices" value={d.cards.overdueInvoices} tone={d.cards.overdueInvoices ? "critical" : undefined} />
    </div>
    {d.attention.length > 0 && (
      <CardList>
        {d.attention.slice(0, 6).map((deal) => (
          <li key={deal.id}>
            <Link href={`/sales?deal=${deal.id}`} className={cn(cardRowClass, "justify-between")}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{deal.title}</span>
                <span className="text-muted-foreground truncate text-caption">{deal.client?.name ?? deal.prospectName}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {deal.stale ? (
                  <StatusBadge value="stale" label={`${deal.daysInStage}d in stage`} />
                ) : (
                  <span className="text-muted-foreground tabular text-caption">Close {formatDateShort(deal.expectedClose!)}</span>
                )}
                <MoneyText value={deal.value} currency={deal.currency} />
              </span>
            </Link>
          </li>
        ))}
      </CardList>
    )}
  </DashboardCard>
));

/** Finance module: payment proofs to verify. */
export const ProofQueueCard = defineCard({ id: "P2-PROOFS", title: "Payments to verify", span: "narrow" }, (ctx) => loadProofQueue(ctx.user), (rows, _ctx, meta) => (
  <DashboardCard
    {...meta}
    count={rows.length}
    countTone="warning"
    action={{ label: "Payments", href: "/payments?tab=verify" }}
    isEmpty={!rows.length}
    emptyText="No proofs waiting."
    emptyIcon="payments"
  >
    <CardList>
      {rows.slice(0, 6).map((p) => (
        <li key={p.id}>
          <Link href={`/invoices/${p.invoiceId}`} className={cn(cardRowClass, "justify-between")}>
            <span className="flex min-w-0 flex-col">
              <span className="tabular truncate">{p.number ?? "Invoice"}</span>
              <span className="text-muted-foreground truncate text-caption">
                {p.client} · since {formatDateShort(p.submittedOn)}
              </span>
            </span>
            <MoneyText value={p.amount} currency={p.currency} />
          </Link>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

/** Finance module: clients with overdue receivables, most late first. */
export const AgingCard = defineCard({ id: "P2-AGING", title: "Overdue by client", span: "narrow" }, (ctx) => loadAgingWidget(ctx.user), (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} countTone="critical" action={{ label: "Invoices", href: "/invoices?status=overdue" }} isEmpty={!rows.length} emptyText="No client is late." emptyIcon="clients">
    <CardList>
      {rows.slice(0, 6).map((r) => (
        <li key={r.clientId}>
          <Link href={`/clients/${r.clientId}?tab=invoices`} className={cn(cardRowClass, "justify-between")}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{r.client}</span>
              <span className="text-muted-foreground text-caption">{r.buckets.late_60_plus > 0 ? "Over 60 days" : r.buckets.late_31_60 > 0 ? "31–60 days" : "1–30 days"} late</span>
            </span>
            <MoneyText value={r.total - r.buckets.not_due} currency="IDR" className="text-destructive" />
          </Link>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

/** Finance / People modules: obligations coming up (payroll, BPJS, tax). */
export const ObligationsCard = defineCard({ id: "P2-OBLIGATIONS", title: "Obligations", span: "narrow" }, (ctx) => loadUpcomingObligations(ctx.user), (d, _ctx, meta) => (
  <DashboardCard {...meta} count={d.items.length} isEmpty={!d.items.length} emptyText="Nothing due in the next 14 days." emptyIcon="calendar">
    <CardList>
      {d.items.slice(0, 6).map((it) => (
        <li key={it.key} className={cn(cardRowClass, "justify-between")}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{it.title}</span>
            <span className="text-muted-foreground text-caption">{it.kind === "invoice" ? "Invoice" : OBLIGATION_KIND_LABELS[it.kind]}</span>
          </span>
          <span className={cn("tabular shrink-0 text-caption", it.startDate < d.today ? "text-destructive" : "text-muted-foreground")}>
            {it.startDate < d.today ? "Past due · " : ""}
            {formatDateShort(it.startDate)}
          </span>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

type Widget = { id: string; Card: (p: { ctx: DashboardContext }) => React.ReactNode; visible: (w: WidgetContext) => boolean };

/**
 * The widget registry (PRD "Revisi dashboard"): each widget appears when the
 * person has that responsibility. Presets list the ones they already show.
 */
export const WIDGETS: Widget[] = [
  { id: "kpi", Card: MyKpiCard, visible: (w) => w.hasKpi || w.hasTasks },
  { id: "review", Card: ReviewQueueCard, visible: (w) => w.isReviewer },
  { id: "leave", Card: LeaveConflictsCard, visible: (w) => w.runsProjects },
  { id: "workload", Card: TeamWorkloadCard, visible: (w) => w.hasReports },
  { id: "okr", Card: MyOkrCard, visible: (w) => w.hasOkr },
  { id: "studio-okr", Card: StudioOkrCard, visible: (w) => w.modules.studioReport },
  { id: "pipeline", Card: PipelineCard, visible: (w) => w.modules.sales },
  { id: "proofs", Card: ProofQueueCard, visible: (w) => w.modules.finance },
  { id: "aging", Card: AgingCard, visible: (w) => w.modules.finance },
  { id: "obligations", Card: ObligationsCard, visible: (w) => w.modules.finance || w.modules.people },
];

/** "For you" — the Phase 2 widgets this person gets, under their preset dashboard. */
export async function ForYou({ ctx, user, skip = [] }: { ctx: DashboardContext; user: CurrentUser; skip?: string[] }) {
  const w = await widgetContext(user);
  const shown = WIDGETS.filter((x) => !skip.includes(x.id) && x.visible(w));
  if (!shown.length) return null;
  return (
    <section aria-label="For you" className="flex flex-col gap-3 py-6">
      <h2 className="text-body font-medium">For you</h2>
      <DashboardGrid>
        {shown.map(({ id, Card }) => (
          <Card key={id} ctx={ctx} />
        ))}
      </DashboardGrid>
    </section>
  );
}
