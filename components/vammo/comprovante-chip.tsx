"use client";

/**
 * "Comprovante vinculado" chip (Phase 2.5 R1) — deep-links a ledger row to its
 * comprovante's deep-dive page (`/comprovantes/{documentId}?page=N`). Shared by
 * /energia faturas, /pagamentos, station 360 payments tab and /alugueis.
 *
 * On hover (desktop), a preview card shows the EXACT isolated page that matched,
 * served from Supabase (`/api/files/[id]/page/[page]` — the per-page artifact
 * the pipeline eagerly materializes at match time). The iframe mounts lazily on
 * open; on click / touch the chip still navigates to the deep-dive.
 *
 * Three states:
 *  - linked payment WITH document  → green chip, clickable + hover preview;
 *  - payment without document      → green chip, not clickable (clone-era row);
 *  - `legacy` fallback (sheet-era ultimo_comprovante) → grey outline chip.
 */

import Link from "next/link";
import { Paperclip } from "lucide-react";

import {
  comprovanteHref,
  comprovantePageSrc,
  type PaymentLinkSummary,
} from "@/lib/data/payment-links.shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export function ComprovanteChip({
  summary,
  className,
}: {
  summary: PaymentLinkSummary | null;
  className?: string;
}) {
  if (!summary) return null;
  const href = comprovanteHref(summary);
  const pageSrc = comprovantePageSrc(summary);
  const label = summary.count > 1 ? `Comprovante ×${summary.count}` : "Comprovante";
  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-success/40 bg-success-subtle/40 px-1.5 py-0.5 text-xs font-medium text-success-emphasis",
        href && "underline-offset-2 hover:underline",
        className,
      )}
    >
      <Paperclip className="size-3" strokeWidth={2} />
      {label}
    </span>
  );

  // No linked document → static chip (no deep-link, no preview).
  if (!href) return chip;

  // Clickable + hover preview of the matched page.
  return (
    <HoverCard>
      <HoverCardTrigger
        render={<Link href={href} prefetch={false} onClick={(e) => e.stopPropagation()} />}
      >
        {chip}
      </HoverCardTrigger>
      {pageSrc ? (
        <HoverCardContent
          className="w-[360px] max-w-[90vw]"
          onClick={(e) => e.stopPropagation()}
        >
          <iframe
            src={pageSrc}
            title="Prévia do comprovante"
            className="h-[460px] w-full rounded-md border-0 bg-white"
          />
        </HoverCardContent>
      ) : null}
    </HoverCard>
  );
}
