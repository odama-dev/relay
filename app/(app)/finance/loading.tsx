import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/page-skeletons";

/** Finance Overview while it loads: header, figures, the two cards, the forecast table. */
export default function FinanceLoading() {
  return (
    <div className="flex flex-col">
      <div className="bleed flex flex-col gap-2 border-b pt-8 pb-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div className="bleed flex border-b">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col gap-2 px-6 py-4 first:pl-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="bleed grid gap-4 border-b py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[440px] rounded-xl" />
        <Skeleton className="h-[220px] rounded-xl" />
      </div>
      <div className="bleed flex min-h-12 items-center border-b">
        <Skeleton className="h-3.5 w-36" />
      </div>
      <DataTableSkeleton cols={8} rows={4} />
    </div>
  );
}
