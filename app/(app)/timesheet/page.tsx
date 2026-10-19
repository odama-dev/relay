import { requireUser } from "@/lib/auth";
import { getTimesheet } from "@/lib/time/queries";
import { isIsoDate, todayIn } from "@/lib/time/pure";
import { PageHeader } from "@/components/page-header";
import { TimesheetView } from "./timesheet-view";

export const metadata = { title: "Timesheet" };

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireUser();
  const { week } = await searchParams;
  const sheet = await getTimesheet(user, isIsoDate(week) ? week : todayIn(user.timezone));
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader title="Timesheet" compact />
      <TimesheetView sheet={sheet} />
    </div>
  );
}
