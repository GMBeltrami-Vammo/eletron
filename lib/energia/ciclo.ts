/**
 * Q11 — the Enel/EDP bill lifecycle ("Ciclo"), OUR processing status as opposed
 * to the portal's (spec: docs/superpowers/specs/2026-07-09-q11-enel-edp-lifecycle-design.md).
 *
 *  1 · Detectada         — portal lists the bill but the PDF was not downloaded/
 *                          parsed yet (≈0 on the frozen clone; live-feed only).
 *  2 · Analisada         — PDF downloaded + parsed (charge with valor).
 *  3 · Enviada ao fiscal — fiscal_exported (decision #21: NOT "paid").
 *  4 · Paga              — comprovante vinculado (decision #29: paid ⟺ receipt).
 *
 * Furthest-point-wins: Paga > Enviada ao fiscal > Analisada > Detectada — a
 * bill paid before the fiscal export still shows "Paga". Pure derivation, no
 * schema: callers translate charge/payment/portal facts into these booleans.
 *
 * NB (Gabriel 2026-07-18): for ENERGY the `isPaid` fed here MUST be computed via
 * `energyCicloIsPaid` — a bare settled `charge.status` (e.g. the 'pago' the
 * frozen clone imported from the portal/scraper, most of which aren't even
 * portal-"paga") does NOT count as Paga; only a bound comprovante (#29) or a R$0
 * fatura settled by #42 does. The portal's own status stays visible in the
 * separate "Status provedor" column.
 */

export type CicloStage = 1 | 2 | 3 | 4;

/**
 * Whether an ENERGY fatura is "Paga" for the Ciclo. Paga ⟺ a bound comprovante
 * (#29) OR a R$0 fatura settled by settle_zero_value_faturas (#42 — nothing to
 * pay). A settled status WITHOUT a comprovante (the clone's portal-derived
 * 'pago') is NOT Paga. `settled` = status ∈ pago/conciliado/antecipado.
 */
export function energyCicloIsPaid(input: {
  settled: boolean;
  amount: number | null;
  hasComprovante: boolean;
  /** Pre-cutoff backlog fatura closed out (#71) — counts as Paga, comprovante dispensado. */
  legacyClosed?: boolean;
}): boolean {
  return (
    input.hasComprovante ||
    (input.amount === 0 && input.settled) ||
    input.legacyClosed === true
  );
}

export interface CicloInput {
  /** The portal shows a bill (account state with billStatus/dueDate) or a charge row exists. */
  hasBillSignal: boolean;
  /** A parsed charge exists (amount extracted from the PDF). */
  hasParsedCharge: boolean;
  /** charges.fiscal_exported — "Financeiro Check" / "No Fiscal" (decision #21). */
  fiscalExported: boolean;
  /** status pago/antecipado OR a receipt-bound payment (decision #29). */
  isPaid: boolean;
}

/** Stage reached by the bill, or null when there is no bill at all. */
export function energyCicloStage(input: CicloInput): CicloStage | null {
  if (input.isPaid) return 4;
  if (input.hasParsedCharge && input.fiscalExported) return 3;
  if (input.hasParsedCharge) return 2;
  if (input.hasBillSignal) return 1;
  return null;
}
