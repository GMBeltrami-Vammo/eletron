import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "success" | "warning" | "error" | "info";

const toneValueClass: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success-emphasis",
  warning: "text-warning-emphasis",
  error: "text-error",
  info: "text-info-emphasis",
};

/**
 * Mirrors the vammo-ui / coupons-dashboard Home StatCard lockup.
 * `href` makes the whole card a filter link (dashboard KPI → filtered table).
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: StatTone;
  href?: string;
  className?: string;
}) {
  const body = (
    <Card
      className={cn(
        "h-full gap-0 py-4 transition-shadow",
        href && "hover:shadow-md",
        className,
      )}
    >
      <CardContent className="px-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            toneValueClass[tone],
          )}
        >
          {value}
        </div>
        {sub ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
