import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";

/** Suspense fallback mirroring the 360° layout (no spinners rule). */
export function StationSkeleton() {
  return (
    <div>
      {/* PageHeader */}
      <div className="flex items-start justify-between gap-3 pb-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
      {/* Freshness ribbon */}
      <Skeleton className="mb-4 h-9 w-full" />
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Identity card */}
        <div className="w-full shrink-0 space-y-2 lg:w-72">
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
        {/* Tabs + table */}
        <div className="min-w-0 flex-1 space-y-4">
          <Skeleton className="h-8 w-full max-w-xl" />
          <DataTableSkeleton rows={8} />
        </div>
      </div>
    </div>
  );
}
