import { cn } from "@/lib/utils";
import { hoursSince, relativeTime } from "@/lib/format";

/**
 * Freshness semaphore: green under warnHours, yellow between warn and
 * critical, red past criticalHours (or missing). Scraper-derived surfaces
 * must always carry one of these (repo rule: freshness is first-class UI).
 */
export function FreshnessDot({
  timestamp,
  warnHours = 26,
  criticalHours = 48,
  label,
  className,
}: {
  timestamp: string | null | undefined;
  warnHours?: number;
  criticalHours?: number;
  /** Prefix label, e.g. 'Enel'. */
  label?: string;
  className?: string;
}) {
  const hours = hoursSince(timestamp);
  const tone =
    hours === null
      ? "bg-[var(--badge-grey-bg)]"
      : hours > criticalHours
        ? "bg-error"
        : hours > warnHours
          ? "bg-[var(--badge-yellow-bg)]"
          : "bg-success";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      title={timestamp ?? "sem dados"}
    >
      <span className={cn("size-2 shrink-0 rounded-full", tone)} />
      {label ? <span className="font-medium">{label}:</span> : null}
      <span>{relativeTime(timestamp)}</span>
    </span>
  );
}
