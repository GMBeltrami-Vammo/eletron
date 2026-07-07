import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Breadcrumb back to the review hub, used by every /revisao/* subpage. */
export function BackLink({
  href = "/revisao",
  label = "Revisão",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" strokeWidth={2} />
      {label}
    </Link>
  );
}
