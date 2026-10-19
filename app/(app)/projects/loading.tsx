import { DataTableSkeleton, FilterBarSkeleton, PageHeaderSkeleton } from "@/components/page-skeletons";

/** Projects list while it loads: header, the four filters + search, a six-column table. */
export default function ProjectsLoading() {
  return (
    <div className="flex flex-col">
      <PageHeaderSkeleton />
      <FilterBarSkeleton filters={4} />
      <DataTableSkeleton cols={6} primary />
    </div>
  );
}
