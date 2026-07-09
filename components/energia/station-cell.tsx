"use client";

import Link from "next/link";

import { StatusBadge } from "@/components/vammo/status-badge";
import { MATCH_STATUS_UI } from "@/lib/labels";
import type { MatchStatus } from "@/lib/domain";

/**
 * Station column cell: link to the 360° when matched, MATCH_STATUS badge
 * (linking to the review queue) when the row is unmatched/needs review.
 */
export function StationCell({
  stationId,
  matchStatus,
}: {
  stationId: number | null;
  matchStatus: MatchStatus;
}) {
  // stopPropagation: the /energia Instalações table wires an onRowClick (Q11
  // history drawer), so an in-cell link must not also trigger the row handler.
  if (stationId !== null) {
    return (
      <Link
        href={`/estacoes/${stationId}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium tabular-nums underline-offset-2 hover:underline"
      >
        #{stationId}
      </Link>
    );
  }
  const ui = MATCH_STATUS_UI[matchStatus];
  return (
    <Link
      href="/revisao"
      title="Abrir fila de revisão"
      onClick={(e) => e.stopPropagation()}
    >
      <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
    </Link>
  );
}
