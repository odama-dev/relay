import { requireAccess } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { getMyTasks } from "@/lib/tasks/queries";
import { todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { TaskPanel } from "@/components/tasks/task-panel";
import { LogTimeButton } from "@/components/time/log-time-dialog";
import { MyTasksView } from "./my-tasks-view";
import { NewTaskButton } from "./new-task-dialog";

export const metadata = { title: "My Tasks" };

/** M2.4 — every open task where you're owner or collaborator, across projects. */
export default async function MyTasksPage() {
  const user = await requireAccess(perms.viewTasks);
  const tasks = await getMyTasks(user);
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        title="My Tasks"
        compact
        actions={
          <>
            <LogTimeButton variant="tertiary" />
            {perms.createOwnTasks(user) && <NewTaskButton isSales={user.role === "sales"} />}
          </>
        }
      />
      <MyTasksView tasks={tasks} today={todayIn(user.timezone)} />
      <TaskPanel />
    </div>
  );
}
