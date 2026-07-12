"use client";

/**
 * "Propostas de unificação" (Peça 2, spec 2026-07-11): a bordered card above
 * the review table listing likely-duplicate cobranças with their proposed
 * surviving target. One click on "Unificar" calls `merge_charge_into` — the
 * duplicate donates its payment instrument/document to the target and becomes
 * `cancelada`. Mirrors the comprovantes ResolvableGroups card pattern.
 */

import * as React from "react";
import { Merge, ArrowRight, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { mergeCharges } from "@/app/actions/cobrancas";
import { CHARGE_KIND_UI, CHARGE_STATUS_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia } from "@/lib/format";

import type { UnifyProposal, UnifyReason } from "./unify-proposals";

const REASON_LABEL: Record<UnifyReason, string> = {
  mesmo_documento: "mesmo documento",
  remetente_valor: "mesma origem + valor",
};

export function UnifyProposalsPanel({
  proposals,
  available,
}: {
  proposals: UnifyProposal[];
  available: boolean;
}) {
  const { run, pending } = useRunAction();
  if (proposals.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Merge className="size-4 text-muted-foreground" strokeWidth={2} />
        <span className="text-sm font-medium">Propostas de unificação</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {proposals.length}
        </span>
        <span className="text-xs text-muted-foreground">
          cobranças da fila que parecem duplicar uma cobrança já identificada —
          confirme para unificar
        </span>
      </div>
      <ul className="divide-y divide-border">
        {proposals.map((p) => {
          const dup = p.duplicate;
          const tgt = p.target;
          const tgtStatus = CHARGE_STATUS_UI[tgt.status];
          return (
            <li
              key={dup.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="inline-flex items-center gap-2">
                <StatusBadge color={CHARGE_KIND_UI[dup.kind].color}>
                  {CHARGE_KIND_UI[dup.kind].label}
                </StatusBadge>
                <span className="font-medium tabular-nums">
                  {formatBRL(dup.amount)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCompetencia(dup.competencia)}
                </span>
                {dup.stationId !== null ? (
                  <span className="font-medium tabular-nums">#{dup.stationId}</span>
                ) : null}
                {dup.parceiro ? (
                  <span className="max-w-48 truncate text-muted-foreground">
                    {dup.parceiro}
                  </span>
                ) : null}
                {dup.documentId ? (
                  <a
                    href={`/api/files/${dup.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-info-emphasis underline-offset-2 hover:underline"
                  >
                    PDF
                    <ExternalLink className="size-3" strokeWidth={2} />
                  </a>
                ) : null}
              </span>

              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />

              <span className="inline-flex items-center gap-2">
                {tgt.stationId !== null ? (
                  <span className="font-medium">
                    #{tgt.stationId} {tgt.stationName ?? ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">sem estação</span>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {formatCompetencia(tgt.competencia)}
                </span>
                <StatusBadge color={tgtStatus.color}>{tgtStatus.label}</StatusBadge>
              </span>

              <span className="ml-auto inline-flex items-center gap-2">
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {REASON_LABEL[p.reason]}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !available}
                  onClick={() =>
                    void run(
                      () =>
                        mergeCharges({
                          duplicateId: dup.id,
                          targetId: tgt.id,
                          reason: p.reason,
                        }),
                      { success: "Cobranças unificadas" },
                    )
                  }
                >
                  <Merge className="size-3.5" strokeWidth={2} />
                  Unificar
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
