import { CardsSkeleton, TableSkeleton } from "@/components/states";

export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <CardsSkeleton />
      <TableSkeleton />
    </div>
  );
}
