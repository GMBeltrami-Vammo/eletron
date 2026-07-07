/**
 * pt-BR display formatting. Pure functions — safe on server and client.
 * All raw-sheet parsing lives in lib/ingest/normalize.ts; this file only
 * formats already-normalized domain values for the UI.
 */

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberPtBr = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return brl.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return numberPtBr.format(value);
}

/** ISO 'YYYY-MM-DD' (or full ISO) → 'dd/mm/aaaa'. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [datePart] = iso.split("T");
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** ISO datetime → 'dd/mm/aaaa HH:mm'. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PT_MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

/** competencia 'YYYY-MM-01' (or 'YYYY-MM') → 'mai/26'. */
export function formatCompetencia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  const monthIndex = Number(m) - 1;
  if (!y || monthIndex < 0 || monthIndex > 11) return iso;
  return `${PT_MONTHS_SHORT[monthIndex]}/${y.slice(2)}`;
}

/**
 * Relative time in pt-BR ('há 6 h', 'há 12 dias', 'agora').
 * `now` injectable for stable server rendering/tests.
 */
export function relativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} dias`;
}

/** Hours elapsed since an ISO timestamp; null-safe. */
export function hoursSince(
  iso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return (now.getTime() - then.getTime()) / 3_600_000;
}
