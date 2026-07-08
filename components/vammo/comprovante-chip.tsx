"use client";

/**
 * "Comprovante vinculado" chip (Phase 2.5 R1) — deep-links a ledger row to its
 * comprovante's deep-dive page (`/comprovantes/{documentId}?page=N`). Shared by
 * /energia faturas, /pagamentos, station 360 payments tab and /alugueis.
 *
 * Three states:
 *  - linked payment WITH document  → green chip, clickable;
 *  - payment without document      → green chip, not clickable (clone-era row);
 *  - `legacy` fallback (sheet-era ultimo_comprovante) → grey outline chip.
 */

import Link from "next/link";
import { Paperclip } from "lucide-react";

import { comprovanteHref, type PaymentLinkSummary } from "@/lib/data/payment-links.shared";
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
  return href ? (
    <Link href={href} prefetch={false} onClick={(e) => e.stopPropagation()}>
      {chip}
    </Link>
  ) : (
    chip
  );
}
