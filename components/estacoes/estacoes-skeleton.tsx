/**
 * Suspense fallback for /estacoes — mirrors the final layout (KPI strip +
 * chips row + table). No spinners (DS rule).
 */

import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";

export function EstacoesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 overflow-hidden pb-1 xl:grid xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 min-w-44 flex-1 rounded-xl xl:min-w-0" />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-32 rounded-full" />
        ))}
      </div>
      <DataTableSkeleton rows={10} />
    </div>
  );
}
