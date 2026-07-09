"use client";

/**
 * Q11 — per-installation fatura history drawer: the account's last
 * competências with valor, vencimento, OUR Ciclo stage, the Drive PDF link and
 * the linked comprovante. Opened by clicking a row on /energia › Instalações.
 */

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ComprovanteChip } from "@/components/vammo/comprovante-chip";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import {
  ACCOUNT_TYPE_UI,
  CICLO_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";

import type { InstalacaoRow } from "./types";

export function InstalacaoHistorySheet({
  row,
  open,
  onOpenChange,
}: {
  /** The clicked installation. Kept set during the close animation so the
   *  panel doesn't flash empty; visibility is driven by `open`. */
  row: InstalacaoRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto p-4 sm:max-w-md">
        {row !== null ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <StatusBadge color={ACCOUNT_TYPE_UI[row.provider].color}>
                  {ACCOUNT_TYPE_UI[row.provider].label}
                </StatusBadge>
                <span className="tabular-nums">{row.installationKey}</span>
              </SheetTitle>
              <SheetDescription className="space-y-0.5">
                {row.stationId !== null ? (
                  <Link
                    href={`/estacoes/${row.stationId}`}
                    className="block font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Estação #{row.stationId}
                  </Link>
                ) : null}
                {row.address ? <span className="block">{row.address}</span> : null}
              </SheetDescription>
            </SheetHeader>

            {/* Current two-status snapshot: portal vs nosso */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Status portal:</span>
                {row.billStatus ? (
                  <StatusBadge color={UTILITY_BILL_STATUS_UI[row.billStatus].color}>
                    {UTILITY_BILL_STATUS_UI[row.billStatus].label}
                  </StatusBadge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Ciclo:</span>
                {row.ciclo !== null ? (
                  <StatusBadge color={CICLO_UI[row.ciclo].color}>
                    {CICLO_UI[row.ciclo].label}
                  </StatusBadge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </div>

            {/* Fatura history, latest first */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Últimas faturas
              </h3>
              {row.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma fatura registrada para esta instalação.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {row.history.map((entry) => (
                    <li
                      key={entry.chargeId}
                      className="rounded-lg border border-border bg-card p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {formatCompetencia(entry.competencia)}
                        </span>
                        <span className="text-sm font-medium tabular-nums">
                          {formatBRL(entry.amount)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <StatusBadge color={CICLO_UI[entry.ciclo].color}>
                          {CICLO_UI[entry.ciclo].label}
                        </StatusBadge>
                        <span className="tabular-nums text-muted-foreground">
                          venc. {formatDate(entry.dueDate)}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {/* Only a receipt-bound payment is a comprovante
                              (decision #29) — don't flash a green chip on a
                              receiptless payment next to a non-Paga ciclo. */}
                          <ComprovanteChip
                            summary={entry.payment?.documentId ? entry.payment : null}
                          />
                          {entry.pdfUrl ? (
                            <a
                              href={entry.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
                            >
                              <ExternalLink className="size-3" strokeWidth={2} />
                              PDF
                            </a>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
