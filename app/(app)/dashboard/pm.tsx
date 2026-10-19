import Link from "next/link";
import { getApprovalQueues } from "@/lib/time/approvals";
import { loadMyProjectHealth, loadProjectBilling, loadTasksAtRisk } from "@/lib/dashboard/queries";
import type { RiskKind } from "@/lib/dashboard/pure";
import { formatDateShort, formatHoursValue } from "@/lib/format";
import { CardGroupLabel, CardList, DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { EntityTabs } from "@/components/entity-tabs";
import { HealthIndicator } from "@/components/health-indicator";
import { StatusBadge } from "@/components/status-badge";
import { OosQueue } from "@/app/(app)/approvals/oos-queue";
import { CorrectionsQueue } from "@/app/(app)/approvals/corrections-queue";
import { cn } from "@/lib/utils";
import { defineCard, RequestRow } from "./card";
import { AssignOwner, TaskRowButton } from "./widgets";

const QUEUE_ROWS = 5;

/** PM-1 — out-of-scope work and time corrections waiting for your decision. */
export const ApprovalQueueCard = defineCard({ id: "PM-1", title: "Waiting for your approval", span: "wide" }, (ctx) => getApprovalQueues(ctx.user), (q, _ctx, meta) => {
  const total = q.oosRows.length + q.correctionRows.length;
  return (
    <DashboardCard
      {...meta}
      count={total}
      countTone="warning"
      action={{ label: "All approvals", href: "/approvals" }}
      isEmpty={total === 0}
      emptyText="Nothing waiting for your approval."
      emptyIcon="approvals"
    >
      <EntityTabs
        initial={q.oosRows.length || !q.correctionRows.length ? "out-of-scope" : "corrections"}
        items={[
          { value: "out-of-scope", label: "Out of scope", count: q.oosRows.length, content: <OosQueue rows={q.oosRows.slice(0, QUEUE_ROWS)} /> },
          { value: "corrections", label: "Time corrections", count: q.correctionRows.length, content: <CorrectionsQueue rows={q.correctionRows.slice(0, QUEUE_ROWS)} /> },
        ]}
      />
    </DashboardCard>
  );
});

/** PM-2 — which of your projects are close to, or over, budget. */
export const MyProjectHealthCard = defineCard({ id: "PM-2", title: "Project health", span: "narrow" }, loadMyProjectHealth, (rows, _ctx, meta) => (
  <DashboardCard {...meta} count={rows.length} action={{ label: "Health", href: "/health" }} isEmpty={rows.length === 0} emptyText="No active projects yet." emptyIcon="health">
    <CardList>
      {rows.map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}?tab=health`} className={cn(cardRowClass, "items-start py-2")}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">
                <span className="text-muted-foreground tabular">{p.code}</span> {p.name}
              </span>
              <span className="text-muted-foreground truncate text-caption">
                {p.client}
                {p.pendingOosHours > 0 && <> · {formatHoursValue(p.pendingOosHours)} out of scope waiting</>}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge value={p.status} />
              <HealthIndicator health={p} />
            </span>
          </Link>
        </li>
      ))}
    </CardList>
  </DashboardCard>
));

const RISK_GROUPS: { kind: RiskKind; label: string; tone?: "critical" | "warning" }[] = [
  { kind: "overdue", label: "Overdue", tone: "critical" },
  { kind: "blocked", label: "Blocked", tone: "warning" },
  { kind: "no_owner", label: "No owner" },
];
const RISK_ROWS = 10;

/** PM-3 — tasks that could make a project slip. */
export const TasksAtRiskCard = defineCard({ id: "PM-3", title: "Tasks at risk", span: "wide" }, loadTasksAtRisk, (data, _ctx, meta) => {
  let budget = RISK_ROWS;
  const groups = RISK_GROUPS.map((g) => {
    const rows = data.rows.filter((r) => r.risk === g.kind).slice(0, Math.max(0, budget));
    budget -= rows.length;
    return { ...g, rows, count: data.counts[g.kind] };
  }).filter((g) => g.count > 0);
  return (
    <DashboardCard {...meta} count={data.rows.length} countTone={data.counts.overdue ? "critical" : "warning"} isEmpty={data.rows.length === 0} emptyText="Every task is on track." emptyIcon="success">
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.kind} className="flex flex-col gap-1">
            <CardGroupLabel label={g.label} count={g.count} tone={g.tone} />
            {g.rows.length > 0 && (
              <CardList>
                {g.rows.map((t) => (
                  <TaskRowButton
                    key={t.id}
                    taskId={t.id}
                    trailing={g.kind === "no_owner" ? <AssignOwner taskId={t.id} members={data.membersBy[t.projectId] ?? []} /> : undefined}
                  >
                    <span className="min-w-0 truncate">{t.title}</span>
                    <span className="text-muted-foreground shrink-0 text-caption">{t.projectCode}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {g.kind !== "no_owner" && <span className="text-muted-foreground hidden truncate text-caption sm:inline">{t.owner ?? "No owner"}</span>}
                      <span className={cn("tabular w-14 text-right text-caption", t.risk === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                        {t.dueDate ? formatDateShort(t.dueDate) : "—"}
                      </span>
                    </span>
                  </TaskRowButton>
                ))}
              </CardList>
            )}
          </div>
        ))}
      </div>
    </DashboardCard>
  );
});

/** PM-4 — payments due or late on your projects (invoices are read-only for a PM). */
export const ProjectBillingCard = defineCard({ id: "PM-4", title: "Project billing", span: "narrow" }, loadProjectBilling, (rows, _ctx, meta) => {
  const late = rows.filter((r) => r.state === "late");
  return (
    <DashboardCard
      {...meta}
      count={rows.length}
      countTone={late.length ? "critical" : "neutral"}
      action={{ label: "Invoices", href: "/invoices" }}
      isEmpty={rows.length === 0}
      emptyText="No payments due."
      emptyIcon="invoices"
    >
      <div className="flex flex-col gap-3">
        {late.length > 0 && (
          <div className="flex flex-col gap-1">
            <CardGroupLabel label="Late" count={late.length} tone="critical" />
            <CardList>{late.map((r) => <RequestRow key={r.id} r={r} />)}</CardList>
          </div>
        )}
        {rows.length > late.length && (
          <div className="flex flex-col gap-1">
            <CardGroupLabel label="Due within 7 days" count={rows.length - late.length} />
            <CardList>{rows.filter((r) => r.state === "due_soon").map((r) => <RequestRow key={r.id} r={r} />)}</CardList>
          </div>
        )}
      </div>
    </DashboardCard>
  );
});
