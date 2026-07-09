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
 */

export type CicloStage = 1 | 2 | 3 | 4;

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
