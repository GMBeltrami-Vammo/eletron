/**
 * "Faturas a arrumar" (Gabriel 2026-07-21) — an energy fatura (Enel/EDP) the API
 * received with a critical field missing. These are QUARANTINED: excluded from
 * the real tables (/energia › Faturas and /pagamentos › Enel/EDP) so they don't
 * pollute them, and listed only in /revisão › Faturas a arrumar until completed.
 *
 * ONE canonical definition, reused by the /energia + /pagamentos exclusion and
 * the /revisão derivation. Pure (no server-only) so it is unit-testable and can
 * run in any page build.
 *
 * A fatura graduates back to the real tables automatically once the missing data
 * arrives — the live scraper feed (decision #49) re-POSTs the row with the full
 * data, so the predicate stops matching. Manual fix in the queue covers only
 * valor + vencimento (reuses `adjust_charge`); NF/competência wait for the feed.
 */

export type FaturaGap = "vencimento" | "competencia" | "valor" | "nf";

/** Charge-level fields the predicate inspects. `settled` is the caller's
 * SETTLED_CHARGE_STATUSES membership (kept out of here so the module stays pure). */
export interface FaturaFields {
  dueDate: string | null;
  competencia: string | null;
  /** charges.amount is NOT NULL (0 for unparseable), so `settled`/`legacyClosed`
   * disambiguate a genuine R$0 fatura (#42, kept) from a missing value. */
  amount: number | null;
  nf: string | null;
  settled: boolean;
  legacyClosed: boolean;
}

const isBlank = (s: string | null | undefined): boolean =>
  s === null || s === undefined || s.trim() === "";

/** Which critical fields are missing (empty = nothing missing = not "a arrumar"). */
export function faturaGaps(f: FaturaFields): FaturaGap[] {
  const gaps: FaturaGap[] = [];
  if (f.dueDate === null) gaps.push("vencimento");
  if (f.competencia === null) gaps.push("competencia");
  // Missing value: truly null, OR ≤ 0 while NOT a legit settled/legacy R$0 fatura
  // (a real R$0 bill is paid via #42 or legacy-closed via #71 — those are kept).
  if (f.amount === null || (f.amount <= 0 && !f.settled && !f.legacyClosed)) {
    gaps.push("valor");
  }
  if (isBlank(f.nf)) gaps.push("nf");
  return gaps;
}

export function isFaturaAArrumar(f: FaturaFields): boolean {
  return faturaGaps(f).length > 0;
}

/** pt-BR labels for the gap badges. */
export const FATURA_GAP_UI: Record<FaturaGap, string> = {
  vencimento: "Sem vencimento",
  competencia: "Sem competência",
  valor: "Sem valor",
  nf: "Sem nota fiscal",
};
