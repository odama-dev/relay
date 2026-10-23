import { requireUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { loadRatingApprovals, loadRatingTasks } from "@/lib/kpi/ratings";
import { todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { RatingApprovalsTable, RatingTasksTable } from "@/components/kpi/ratings-view";

export const metadata = { title: "Ratings" };

/** PRD Phase 2 "Form penilaian": the ratings you owe this week or month, and (People) self-assessments to approve. */
export default async function RatingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const today = todayIn(user.timezone);
  const [{ tab }, tasks, approvals] = await Promise.all([searchParams, loadRatingTasks(user, today), loadRatingApprovals(user)]);
  const todo = tasks.filter((t) => !t.response).length;
  return (
    <div className="flex flex-col">
      <PageHeader title="Ratings" compact />
      <EntityTabs
        variant="toolbar"
        initial={tab}
        items={[
          { value: "todo", label: "To rate", count: todo || undefined, content: <RatingTasksTable tasks={tasks} /> },
          ...(perms.managePeopleModule(user)
            ? [{ value: "approve", label: "Self-assessments", count: approvals.length || undefined, content: <RatingApprovalsTable rows={approvals} /> }]
            : []),
        ]}
      />
    </div>
  );
}
