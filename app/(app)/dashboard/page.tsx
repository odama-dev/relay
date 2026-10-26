import { requireUser } from "@/lib/auth";
import { perms } from "@/lib/roles";
import { dashboardContext } from "@/lib/dashboard/queries";
import { TaskPanel } from "@/components/tasks/task-panel";
import { DesignerDevDashboard } from "./designer-dev";
import { PmDashboard } from "./pm";
import { ClevelDashboard } from "./clevel/clevel-dashboard";
import { HrDashboard } from "./hr";
import { FinanceDashboard } from "./finance";
import { SalesDashboard } from "./sales";
import { ForYou } from "./phase2-cards";

export const metadata = { title: "Dashboard" };

/**
 * The home screen after sign-in. Each role's dashboard is a preset (PRD
 * Phase 2 "Revisi dashboard"); under it, "For you" adds the widgets that
 * follow the person's responsibilities (lib/dashboard/phase2.ts). Every
 * role has its own layout; Finance's is the operational one of Phase 2 · M10.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role === "c_level") {
    return (
      <>
        <ClevelDashboard user={user} searchParams={await searchParams} />
        <ForYou ctx={dashboardContext(user)} user={user} />
      </>
    );
  }
  if (user.role === "finance") {
    return (
      <>
        <FinanceDashboard user={user} searchParams={await searchParams} />
        {/* The preset already shows the Finance module's widgets. */}
        <ForYou ctx={dashboardContext(user)} user={user} skip={["proofs", "aging", "obligations"]} />
      </>
    );
  }
  {
    const sp = await searchParams;
    return (
      <>
        {user.role === "sales" ? (
          <SalesDashboard user={user} searchParams={sp} />
        ) : user.role === "pm" ? (
          <PmDashboard user={user} searchParams={sp} />
        ) : user.role === "hr" ? (
          <HrDashboard user={user} searchParams={sp} />
        ) : (
          <DesignerDevDashboard user={user} searchParams={sp} />
        )}
        {/* Sales keeps its dashboard to its own preset (no "For you"). */}
        {user.role !== "sales" && <ForYou ctx={dashboardContext(user)} user={user} />}
        {perms.viewTasks(user) && <TaskPanel />}
      </>
    );
  }
}
