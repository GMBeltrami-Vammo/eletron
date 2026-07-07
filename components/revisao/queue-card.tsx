import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One review-queue card on the /revisao hub: count, description, optional
 * oldest-item hint, whole card links to the queue. `count === null` renders
 * an em dash — the queue has no Phase 1 data source (comprovantes).
 */
export function QueueCard({
  title,
  description,
  count,
  hint,
  href,
}: {
  title: string;
  description: string;
  count: number | null;
  hint?: string | null;
  href: string;
}) {
  return (
    <Link href={href} className="block h-full">
      <div className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {title}
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
        </div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            (count === null || count === 0) && "text-muted-foreground",
          )}
        >
          {count === null ? "—" : count}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        {hint ? (
          <p className="mt-1 text-xs font-medium text-foreground/80">{hint}</p>
        ) : null}
      </div>
    </Link>
  );
}
