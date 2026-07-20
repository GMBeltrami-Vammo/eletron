"use client";

/**
 * Comprovante column cell (Gabriel 2026-07-17). One reusable cell for every
 * "Comprovante" column so a blank one always offers manual binding:
 *  - linked → the <ComprovanteChip> (unchanged);
 *  - blank, with a dedupe_key + value → a "Vincular" button opening the
 *    charge-first matcher (BindComprovanteDialog);
 *  - blank without a resolvable charge/value (sheets mode) → "—".
 *
 * The dialog is lazy: mounted only after the first click, so a table of N rows
 * doesn't instantiate N dialogs.
 */

import * as React from "react";
import { Check, Link2 } from "lucide-react";

import { ComprovanteChip } from "@/components/vammo/comprovante-chip";
import { BindComprovanteDialog } from "@/components/comprovantes/bind-comprovante-dialog";
import type { PaymentLinkSummary } from "@/lib/data/payment-links.shared";
import { cn } from "@/lib/utils";

export function ComprovanteCell({
  dedupeKey,
  amount,
  summary,
  waived = false,
  align = "left",
}: {
  /** Charge dedupe_key (the domain Charge.id) — resolved to the uuid server-side. */
  dedupeKey: string | null;
  amount: number | null;
  summary: PaymentLinkSummary | null;
  /** Comprovante dispensado (fatura legada encerrada, #71) — shows a badge, no bind. */
  waived?: boolean;
  align?: "left" | "center";
}) {
  const [open, setOpen] = React.useState(false);
  const wrap = align === "center" ? "flex justify-center" : undefined;

  if (summary) {
    return <span className={wrap}><ComprovanteChip summary={summary} /></span>;
  }

  // Legacy fatura closed out (#71): comprovante waived — a badge, not a bind.
  if (waived) {
    return (
      <span className={wrap}>
        <span
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
          title="Fatura antiga encerrada — comprovante dispensado (#71)"
        >
          <Check className="size-3" strokeWidth={2} />
          Dispensado
        </span>
      </span>
    );
  }

  // Can't bind without a charge key or a value to match by.
  if (!dedupeKey || amount === null) {
    return (
      <span className={cn(wrap, "text-muted-foreground", align === "center" && "block text-center")}>
        —
      </span>
    );
  }

  return (
    <span className={wrap}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-info/50 hover:text-info-emphasis"
      >
        <Link2 className="size-3" strokeWidth={2} />
        Vincular
      </button>
      {open ? (
        <BindComprovanteDialog dedupeKey={dedupeKey} onClose={() => setOpen(false)} />
      ) : null}
    </span>
  );
}
