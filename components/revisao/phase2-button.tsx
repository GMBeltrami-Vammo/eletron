import type { VariantProps } from "class-variance-authority";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Phase 1 is read-only: every mutating control from the UX spec renders
 * disabled with the standard "Disponível na fase 2" hint. The wrapping span
 * carries the title because disabled buttons drop pointer events.
 */
export function Phase2Button({
  children,
  size = "sm",
  variant = "outline",
  className,
}: {
  children: React.ReactNode;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  className?: string;
}) {
  return (
    <span
      title="Disponível na fase 2"
      className={cn("inline-flex cursor-not-allowed", className)}
    >
      <Button variant={variant} size={size} disabled>
        {children}
      </Button>
    </span>
  );
}
