import { asUser, requireUser } from "@/lib/auth";
import { getTimesheet } from "@/lib/time/queries";
import { loadMyLeave } from "@/lib/hr/queries";
import { isIsoDate, parseIsoDate, todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { MyLeave } from "@/components/hr/leave";
import { CheckIn } from "@/components/hr/check-in";
import { TimesheetView } from "./timesheet-view";

export const metadata = { title: "Timesheet" };

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireUser();
  const { week } = await searchParams;
  const today = todayIn(user.timezone);
  const [sheet, leave, attendance] = await Promise.all([
    getTimesheet(user, isIsoDate(week) ? week : today),
    loadMyLeave(user),
    asUser(user, (tx) => tx.attendance.findUnique({ where: { userId_date: { userId: user.id, date: parseIsoDate(today) } }, select: { status: true } })),
  ]);
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader title="Timesheet" compact actions={<CheckIn status={attendance?.status ?? null} />} />
      <TimesheetView sheet={sheet} />
      <div className="bleed border-t pt-6">
        <MyLeave rows={leave} today={today} />
      </div>
    </div>
  );
}
