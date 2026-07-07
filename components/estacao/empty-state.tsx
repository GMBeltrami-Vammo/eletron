import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Neutral empty-state card (DS convention: message + action, no illustration). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-dashed shadow-none", className)}>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        {Icon ? (
          <Icon
            className="size-8 text-muted-foreground/60"
            strokeWidth={2}
            aria-hidden
          />
        ) : null}
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-sm text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
