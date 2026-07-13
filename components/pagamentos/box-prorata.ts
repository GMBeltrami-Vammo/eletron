/**
 * Box-day pro-rata (decisão #50). A station bills the AGREED contract
 * `valor_mensal`, scaled by how many box-days its boxes were actually active in
 * the competência month — so a station that goes from 3 boxes to 6 mid-month
 * pays proportionally, not the full 6-box price, until all boxes are up a whole
 * month.
 *
 *   fraction = min(1, Σ box-days / (30 × N))
 *
 * where N = boxes PRESENT during the month and each present box contributes its
 * active days in the month: a box active before/through the month = 30; a box
 * activated on day D = 30 − D + 1 (capped at 30, floored at 0). The base is a
 * fixed /30 (matches the station-creation pro-rata, decisão #36) and the day
 * count uses 30 − D + 1 (Gabriel's choice — the activation day counts).
 *
 * Because N counts only PRESENT boxes, a steady-state count shortfall (e.g. 5
 * of 6 contracted boxes, all up the whole month) yields fraction 1 → full
 * `valor_mensal` + a boxes_mismatch flag: "sempre use o valor do contrato",
 * only the temporal ramp-up reduces the amount.
 *
 * Pure (no imports) so it is unit-tested AND mirrored branch-for-branch by the
 * SQL in gerar_mes. Inputs are BRT 'YYYY-MM-DD' dates (the sync already
 * converts first_active_ts to a BRT date) so the math is timezone-free.
 */

export const PRORATA_BASE_DAYS = 30;

export interface BoxProrata {
  /** min(1, boxDays / (30 × presentBoxes)). */
  fraction: number;
  boxDays: number;
  /** boxes present (activated on/before the month end). */
  presentBoxes: number;
}

/**
 * Returns the box-day pro-rata basis for `competenciaYm` ('YYYY-MM'), or null
 * when there is no box data to apply (no array, empty, or no present boxes).
 */
export function computeBoxDaysProrata(
  activationDates: ReadonlyArray<string | null> | null | undefined,
  competenciaYm: string,
): BoxProrata | null {
  if (!activationDates || activationDates.length === 0) return null;

  let boxDays = 0;
  let present = 0;
  for (const d of activationDates) {
    if (d == null) {
      // unknown activation date → assume active all month (never under-bill)
      present += 1;
      boxDays += PRORATA_BASE_DAYS;
      continue;
    }
    const ym = d.slice(0, 7); // 'YYYY-MM'
    if (ym > competenciaYm) continue; // activated after this month → not present
    present += 1;
    if (ym < competenciaYm) {
      boxDays += PRORATA_BASE_DAYS; // active before this month → full
    } else {
      const day = Number(d.slice(8, 10)); // day of month (BRT)
      const active = Number.isFinite(day)
        ? Math.max(0, Math.min(PRORATA_BASE_DAYS, PRORATA_BASE_DAYS - day + 1))
        : PRORATA_BASE_DAYS;
      boxDays += active;
    }
  }
  if (present === 0) return null;
  const fraction = Math.min(1, boxDays / (PRORATA_BASE_DAYS * present));
  return { fraction, boxDays, presentBoxes: present };
}
