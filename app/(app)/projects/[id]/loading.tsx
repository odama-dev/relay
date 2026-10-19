import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton, DetailHeaderSkeleton } from "@/components/page-skeletons";

/** A project while it loads: header and tabs, then the task list's toolbar and rows. */
export default function ProjectLoading() {
  return (
    <div className="flex flex-col">
      <DetailHeaderSkeleton tabs={5} actions={3} />
      <div className="flex items-center justify-between py-4">
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <DataTableSkeleton cols={5} rows={6} />
    </div>
  );
}
