import { getApprovalQueues } from "@/lib/time/approvals";
import { loadComplianceSummary, loadTasksPerPerson, loadTeamComposition } from "@/lib/dashboard/queries";
import { employmentLabel, roleLabel } from "@/lib/roles";
import { formatRelative } from "@/lib/format";
import { CardFigure, CardGroupLabel, CardList, DashboardCard, cardRowClass } from "@/components/dashboard-card";
import { LinkButton } from "@/components/link-button";
import { CorrectionsQueue } from "@/app/(app)/approvals/corrections-queue";
import { cn } from "@/lib/utils";
import { defineCard } from "./card";
import { ResendInviteButton, TasksPerPersonTable } from "./widgets";

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/** HR-1 — who hasn't logged time this week. */
export const ComplianceCard = defineCard({ id: "HR-1", title: "Time logging this week", span: "wide" }, loadComplianceSummary, (d, _ctx, meta) => (
  <DashboardCard
    {...meta}
    count={d.incomplete.length}
    countTone="warning"
    action={
      <>
        <LinkButton size="compact" variant="ghost" icon="csv" external href={`/api/compliance?week=${d.weekStart}`}>
          CSV
        </LinkButton>
        <LinkButton size="compact" variant="tertiary" href={`/people/compliance?week=${d.weekStart}`}>
          Compliance
        </LinkButton>
      </>
    }
  >
    <div className="flex flex-col gap-3">
      <CardFigure label="Complete" value={`${d.complete} of ${d.people}`} hint="people logged every past workday" />
      {d.incomplete.length === 0 ? (
        <p className="text-muted-foreground text-body">Everyone has logged their time this week.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <CardGroupLabel label="Empty workdays" count={d.incomplete.length} tone="warning" />
          <CardList>
            {d.incomplete.slice(0, 8).map((p) => (
              <li key={p.id} className={cardRowClass}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-muted-foreground hidden w-36 shrink-0 truncate text-caption sm:block">{roleLabel(p.role)}</span>
                <span className="flex shrink-0 gap-1">
                  {p.missing.map((d) => (
                    <span key={d} className="bg-warning/12 text-warning rounded-md px-1.5 text-micro">
                      {WEEKDAY.format(new Date(`${d}T00:00:00Z`))}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </CardList>
          {d.incomplete.length > 8 && <p className="text-muted-foreground text-caption">{d.incomplete.length - 8} more on the compliance page</p>}
        </div>
      )}
    </div>
  </DashboardCard>
));

/** HR-2 — corrections to non-billable time, which HR reviews. */
export const HrCorrectionsCard = defineCard({ id: "HR-2", title: "Time corrections", span: "narrow" }, (ctx) => getApprovalQueues(ctx.user), (q, _ctx, meta) => (
  <DashboardCard
    {...meta}
    count={q.correctionRows.length}
    countTone="warning"
    action={{ label: "Approvals", href: "/approvals?tab=corrections" }}
    isEmpty={q.correctionRows.length === 0}
    emptyText="No corrections waiting."
    emptyIcon="approvals"
  >
    <CorrectionsQueue rows={q.correctionRows.slice(0, 5)} />
  </DashboardCard>
));

/** HR-3 — who's overloaded or falling behind. */
export const TasksPerPersonCard = defineCard({ id: "HR-3", title: "Tasks per person", span: "wide" }, loadTasksPerPerson, (rows, _ctx, meta) => (
  <DashboardCard {...meta} isEmpty={rows.length === 0} emptyText="No active people yet." emptyIcon="people">
    <TasksPerPersonTable rows={rows} />
  </DashboardCard>
));

/** HR-4 — the team by employment type and role; invitations still open. */
export const TeamCompositionCard = defineCard({ id: "HR-4", title: "Team", span: "narrow" }, loadTeamComposition, (d, _ctx, meta) => (
  <DashboardCard {...meta} action={{ label: "People", href: "/people" }}>
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <CardFigure label="Active people" value={d.total} />
        <CardFigure label="Invited" value={d.invited.length} hint={d.invited.length ? "not signed in yet" : undefined} tone={d.invited.length ? "warning" : undefined} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body">
        {d.byType.map((t) => (
          <div key={t.type} className="contents">
            <dt className="text-muted-foreground">{employmentLabel(t.type)}</dt>
            <dd className="tabular text-right">{t.count}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body">
        {d.byRole.map((r) => (
          <div key={r.role} className="contents">
            <dt className="text-muted-foreground truncate">{roleLabel(r.role)}</dt>
            <dd className="tabular text-right">{r.count}</dd>
          </div>
        ))}
      </dl>
      {d.invited.length > 0 && (
        <div className="flex flex-col gap-1">
          <CardGroupLabel label="Waiting to join" count={d.invited.length} />
          <CardList>
            {d.invited.map((p) => (
              <li key={p.id} className={cn(cardRowClass, "py-1.5")}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{p.name}</span>
                  <span className="text-muted-foreground truncate text-caption">
                    {roleLabel(p.role)} · invited {formatRelative(p.invitedAt)}
                  </span>
                </span>
                <ResendInviteButton personId={p.id} />
              </li>
            ))}
          </CardList>
        </div>
      )}
    </div>
  </DashboardCard>
));
