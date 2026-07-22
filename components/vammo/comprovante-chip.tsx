"use client";

/**
 * "Comprovante vinculado" chip — on click/tap opens the EXACT matched page of
 * the bound comprovante (`/api/files/[documentId]/page/[page]`, the isolated
 * per-page Supabase artifact #39/#41) in a new tab, NOT the whole document
 * (Gabriel 2026-07-21). Hover (desktop) previews the same page. Shared by
 * /energia faturas, /pagamentos, station 360 payments tab and /alugueis.
 *
 * Three states:
 *  - linked payment WITH document  → green chip, clickable (nova aba) + hover;
 *  - payment without document      → green chip, not clickable (clone-era row);
 *  - `legacy` fallback (summary=null upstream) → handled before this renders.
 */

import { Paperclip } from "lucide-react";

import {
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
  // The isolated matched page (falls back to page 1) — both the click target
  // and the hover preview point here, so the row shows ONLY this bill's page.
  const pageSrc = comprovantePageSrc(summary);
  const label = summary.count > 1 ? `Comprovante ×${summary.count}` : "Comprovante";
  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-success/40 bg-success-subtle/40 px-1.5 py-0.5 text-xs font-medium text-success-emphasis",
        pageSrc && "underline-offset-2 hover:underline",
        className,
      )}
    >
      <Paperclip className="size-3" strokeWidth={2} />
      {label}
    </span>
  );

  // No linked document → static chip (no page to open, no preview).
  if (!pageSrc) return chip;

  // Clickable (opens the isolated matched page in a new tab) + hover preview.
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <a
            href={pageSrc}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        {chip}
      </HoverCardTrigger>
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
    </HoverCard>
  );
}
