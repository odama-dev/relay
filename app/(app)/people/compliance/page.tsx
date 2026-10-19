import { requireAccess } from "@/lib/auth";
import { perms, roleLabel, USER_ROLES } from "@/lib/roles";
import { getCompliance } from "@/lib/time/compliance";
import { isIsoDate, todayIn } from "@/lib/time/pure";
import type { UserRole } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { ComplianceView } from "./compliance-view";

export const metadata = { title: "Time Compliance" };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAccess(perms.viewCompliance);
  const sp = await searchParams;
  const today = todayIn(user.timezone);
  const week = typeof sp.week === "string" && isIsoDate(sp.week) ? sp.week : today;
  const role = typeof sp.role === "string" && USER_ROLES.includes(sp.role as UserRole) ? (sp.role as UserRole) : undefined;
  const data = await getCompliance(user, week, today, role);
  return (
    <div className="flex flex-col">
      <PageHeader title="Time Compliance" compact actions={<FilterBar variant="bare" searchPlaceholder="Search name" />} />
      <div className="pt-4">
        <ComplianceView
          data={data}
          today={today}
          role={role}
          filters={
            <FilterBar
              variant="bare"
              search={false}
              filters={[{ param: "role", label: "Role", allLabel: "All roles", options: USER_ROLES.filter((r) => r !== "c_level").map((r) => ({ value: r, label: roleLabel(r) })) }]}
            />
          }
        />
      </div>
    </div>
  );
}
