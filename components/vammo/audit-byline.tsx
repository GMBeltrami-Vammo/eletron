import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "por {user} em {data}" line shown after every mutating action (the goBuy
 * request_events pattern surfaced in the UI). Muted, 12px. `actorEmail` of the
 * form 'system:{job}' renders as "pelo sistema".
 */
export function AuditByline({
  actorEmail,
  at,
  className,
}: {
  actorEmail: string | null | undefined;
  at: string | null | undefined;
  className?: string;
}) {
  if (!actorEmail && !at) return null;
  const who = !actorEmail
    ? "—"
    : actorEmail.startsWith("system:")
      ? "pelo sistema"
      : `por ${actorEmail}`;
  return (
    <span
      className={cn("text-xs text-muted-foreground", className)}
      title={at ?? undefined}
    >
      {who}
      {at ? ` em ${formatDateTime(at)}` : ""}
    </span>
  );
}
