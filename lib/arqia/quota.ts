/**
 * ARQIA quota math (pure, unit-tested) — mirrors the n8n workflow
 * `Alerta - SIM_Data_Arqia` (Calculate pro-rata-quota + Calculate Usage), so the
 * app produces the same numbers. No server-only import.
 */

/** '300.00 MB' / '1024 KB' / '1.5 GB' → float in MB (binary base 1024). */
export function parseDataUnitMb(valueStr: string | null | undefined): number {
  if (!valueStr || typeof valueStr !== "string") return 0;
  const parts = valueStr.trim().split(/\s+/);
  const value = parseFloat(parts[0]);
  if (!Number.isFinite(value)) return 0;
  const unit = (parts[1] ?? "MB").toUpperCase();
  const map: Record<string, number> = {
    GB: 1024,
    MB: 1,
    KB: 1 / 1024,
    B: 1 / 1024 ** 2,
  };
  return value * (map[unit] ?? 1);
}

/** Total days in a month (month is 1-indexed here). */
export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export const PER_SIM_MONTHLY_QUOTA_MB = 300;

export interface QuotaSim {
  /** ISO 'YYYY-MM-DD' — when the SIM was first seen (pro-rata base). */
  firstSeenOn: string;
}

/**
 * Pró-rata monthly quota (MB): 300/SIM, but a SIM first seen DURING the current
 * month is pro-rated by `(lastDay - day + 2) / lastDay` — the exact n8n formula.
 * `now` gives the reference month. Only pass ACTIVE sims.
 */
export function proRataQuotaMb(
  sims: QuotaSim[],
  now: Date,
  perSimMb: number = PER_SIM_MONTHLY_QUOTA_MB,
): number {
  const curYear = now.getFullYear();
  const curMonth1 = now.getMonth() + 1; // 1-indexed
  const lastDay = daysInMonth(curYear, curMonth1);

  let total = 0;
  for (const sim of sims) {
    const [y, m, d] = (sim.firstSeenOn ?? "").split("-").map((n) => parseInt(n, 10));
    const inCurrentMonth =
      Number.isFinite(y) && Number.isFinite(m) && y === curYear && m === curMonth1;
    if (inCurrentMonth && Number.isFinite(d)) {
      const daysRemaining = lastDay - d + 2;
      total += (daysRemaining / lastDay) * perSimMb;
    } else {
      total += perSimMb;
    }
  }
  return Math.round(total);
}

/** Fraction of the current month elapsed (0–100), for the "month %" reference. */
export function monthElapsedPct(now: Date): number {
  const last = daysInMonth(now.getFullYear(), now.getMonth() + 1);
  return round2((now.getDate() / last) * 100);
}

/** consumption / quota * 100 (0 when quota is 0). */
export function usagePct(consumptionMb: number, quotaMb: number): number {
  return quotaMb > 0 ? round2((consumptionMb / quotaMb) * 100) : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
