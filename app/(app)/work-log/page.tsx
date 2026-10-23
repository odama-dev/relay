import { requireUser } from "@/lib/auth";
import { loadWorkLogs } from "@/lib/kpi/log-queries";
import { todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { EntityTabs } from "@/components/entity-tabs";
import { LogWorkButton } from "@/components/kpi/work-log-dialog";
import { WorkLogTable } from "@/components/kpi/work-log-table";

export const metadata = { title: "Work Log" };

/** PRD Phase 2 "Output": shots, content, ideas, support, QC, errors, releases, testimonies and challenges — the data KPI metrics count. */
export default async function WorkLogPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const [{ tab }, data] = await Promise.all([searchParams, loadWorkLogs(user)]);
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Work Log"
        compact
        actions={<LogWorkButton today={todayIn(user.timezone)} viewerId={user.id} people={data.people} projects={data.projects} />}
      />
      <EntityTabs
        variant="toolbar"
        initial={tab}
        items={[
          { value: "mine", label: "My log", count: data.mine.length || undefined, content: <WorkLogTable rows={data.mine} mode="mine" /> },
          { value: "review", label: "To review", count: data.queue.length || undefined, content: <WorkLogTable rows={data.queue} mode="review" /> },
        ]}
      />
    </div>
  );
}
