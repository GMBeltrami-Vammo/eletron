import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";

/** Skeleton matching the contract detail layout (no spinners). */
export default function ContractDetailLoading() {
  return (
    <div>
      <div className="flex items-start justify-between pb-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-52 w-full rounded-xl" />
        ))}
        <Skeleton className="h-24 w-full rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="mt-6 mb-3 h-6 w-48" />
      <DataTableSkeleton rows={6} />
    </div>
  );
}
