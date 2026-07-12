/**
 * Pure builder for the "Propostas de unificação" panel (spec 2026-07-11,
 * Peça 2). A review-queue charge is proposed as a DUPLICATE of an identified/
 * settled target when the evidence ties them:
 *   1. mesmo_documento — same source document + same amount (strongest: the
 *      redelivery/UNIDENTIFIED-then-MATCHED shape from the live batch).
 *   2. remetente_valor — same CNPJ or sender + same competência + same amount,
 *      target identified (station) — the ND↔boleto "banco" shape (caso DIA).
 * One proposal per duplicate AND per target (ambiguity → stays in the manual
 * queue); confirmation is always human, 1 click (Gabriel's call).
 * No React/server imports — unit-testable.
 */

import type { MergeTargetRow, ReviewChargeRow } from "@/app/(app)/revisao/cobrancas/queries";

export type UnifyReason = "mesmo_documento" | "remetente_valor";

export interface UnifyProposal {
  duplicate: ReviewChargeRow;
  target: MergeTargetRow;
  reason: UnifyReason;
}

const TOL = 0.01;

function amountsEqual(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= TOL;
}

function digitsEq(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const da = a.replace(/\D/g, "").replace(/^0+/, "");
  const db = b.replace(/\D/g, "").replace(/^0+/, "");
  return da.length > 0 && da === db;
}

/** A target can absorb a duplicate only if it ADDS identity or is settled. */
function isViableTarget(t: MergeTargetRow, dup: ReviewChargeRow): boolean {
  if (t.id === dup.id) return false;
  if (t.status === "cancelada" || t.status === "nao_aplicavel") return false;
  // an unidentified open target adds nothing — merging would lose nothing but
  // also solve nothing; keep those in the manual flow
  return t.stationId !== null || t.status === "pago" || t.dedupeKey.startsWith("pag:");
}

/**
 * A duplicate that already asserts a DIFFERENT station (or a different kind) is
 * positive evidence it is NOT the same logical charge as the target — the
 * same-landlord / same-value / same-month multi-station case (decision #4's
 * Hubees ND across ~16 stations; decision #44's "one landlord, N stations, same
 * value"). Only a station-less duplicate (still unidentified) or one on the same
 * station, same kind, may be proposed for merge; anything else stays in the
 * manual queue where a human resolves it with full context.
 */
function sameEntity(dup: ReviewChargeRow, t: MergeTargetRow): boolean {
  if (
    dup.stationId !== null &&
    t.stationId !== null &&
    dup.stationId !== t.stationId
  ) {
    return false;
  }
  return dup.kind === t.kind;
}

function tierOf(dup: ReviewChargeRow, t: MergeTargetRow): UnifyReason | null {
  if (!amountsEqual(dup.amount, t.amount)) return null;
  if (!sameEntity(dup, t)) return null;
  if (
    dup.documentId !== null &&
    t.sourceDocumentId !== null &&
    dup.documentId === t.sourceDocumentId
  ) {
    return "mesmo_documento";
  }
  const sameKey =
    digitsEq(dup.issuerCnpj, t.issuerCnpj) ||
    (!!dup.emailSender && !!t.emailSender && dup.emailSender === t.emailSender);
  const sameComp =
    dup.competencia !== null && t.competencia !== null && dup.competencia === t.competencia;
  if (sameKey && sameComp && t.stationId !== null) return "remetente_valor";
  return null;
}

export function buildUnifyProposals(
  rows: ReviewChargeRow[],
  targets: MergeTargetRow[],
): UnifyProposal[] {
  const proposals: UnifyProposal[] = [];
  const usedTargets = new Set<string>();

  for (const dup of rows) {
    // a duplicate carrying payments/settlement, or a terminal/not-applicable
    // one, is not a merge candidate — merge_charge_into refuses all three, so a
    // proposal for one would be dead weight that only errors on click.
    if (
      dup.status === "pago" ||
      dup.status === "cancelada" ||
      dup.status === "nao_aplicavel"
    ) {
      continue;
    }

    const tier1: MergeTargetRow[] = [];
    const tier2: MergeTargetRow[] = [];
    for (const t of targets) {
      if (!isViableTarget(t, dup) || usedTargets.has(t.id)) continue;
      const tier = tierOf(dup, t);
      if (tier === "mesmo_documento") tier1.push(t);
      else if (tier === "remetente_valor") tier2.push(t);
    }

    // exactly ONE candidate in the strongest non-empty tier ⇒ propose;
    // anything else is ambiguous → manual flow
    const pick =
      tier1.length === 1 ? { t: tier1[0], reason: "mesmo_documento" as const }
      : tier1.length === 0 && tier2.length === 1
        ? { t: tier2[0], reason: "remetente_valor" as const }
        : null;
    if (!pick) continue;

    usedTargets.add(pick.t.id);
    proposals.push({ duplicate: dup, target: pick.t, reason: pick.reason });
  }
  return proposals;
}
