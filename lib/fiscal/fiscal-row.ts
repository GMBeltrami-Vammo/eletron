/**
 * Pure fiscal-row construction (decision #42) — NO `server-only`, no I/O, so it
 * is unit-testable and the exact 12-column format is pinned by tests. The
 * server orchestration (sheet read/write) lives in send-fiscal.ts.
 *
 * "This cannot be mistaken": the format matches the two real rows Gabriel
 * provided (fiscal-sheet.test.ts), and `selfVerifyRow` round-trips every built
 * row back through the READ parser before it is ever appended.
 */

import { parseFiscalRow } from "./fiscal-sheet";
import type { FaturaRef } from "./check-faturas";

/** The only year the send is validated for; ≥ next year is blocked pending review. */
export const SENDABLE_YEAR = 2026;

const SUPPLIER: Record<"enel" | "edp", string> = {
  enel: "Eletropaulo Metropolitana Eletrecidade de São Paulo S/A",
  edp: "EDP São Paulo Distribuição de Energia S/A",
};
const STATUS = "Upload de Fatura via Eletron - Aguardando Fiscal";
const CATEGORY = "401: Charging Infra/Energy: Electricity";
const ACCOUNT = "COGS - 401: Charging Infra/Energy: Electricity";

/** 40.24 → "40,24" (comma decimal, NO thousands separator — per the samples). */
export function formatValorBR(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** ISO 'YYYY-MM-DD' → 'DD/MM/YYYY'. */
export function formatDueDateBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** A `Date` rendered as São Paulo local time 'DD/MM/YYYY HH:MM:SS'. */
export function nowFiscalTimestamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}:${p("second")}`;
}

/**
 * Builds the 12-column fiscal row for a fatura. `sep` is the HYPERLINK argument
 * separator (';' on a pt-BR sheet). Col 1 is always "DA" (only Cadastrado
 * faturas are ever sent); Enel's description has NO " DA" suffix, EDP's does —
 * exactly as in the two real sample rows.
 */
export function buildFiscalRow(
  f: FaturaRef,
  timestamp: string,
  sep: ";" | ",",
): string[] {
  const idSuffix = f.provider === "edp" && f.autoDebit === "cadastrado" ? " DA" : "";
  const descricao = `Consumo de energia - ${f.installationId}${idSuffix}`;
  const verFatura = f.driveUrl
    ? `=HYPERLINK("${f.driveUrl}"${sep}"Ver Fatura")`
    : "Ver Fatura";
  return [
    timestamp,
    "DA",
    SUPPLIER[f.provider],
    f.amount === null ? "" : formatValorBR(f.amount),
    f.nf ?? "",
    descricao,
    formatDueDateBR(f.dueDate),
    CATEGORY,
    ACCOUNT,
    "",
    STATUS,
    verFatura,
  ];
}

/**
 * Round-trips a built row back through the parser used to READ the fiscal sheet
 * and asserts it decodes to the fatura's id / due date / nota fiscal / valor. If
 * this fails the row must NOT be appended — it would also mean the check could
 * not later find it (breaking idempotency). The strongest guard against a
 * malformed row, since there is no human preview step.
 */
export function selfVerifyRow(row: string[], f: FaturaRef): boolean {
  const parsed = parseFiscalRow(row, 1);
  if (!parsed) return false;
  if (parsed.installationId !== f.installationId) return false;
  if (parsed.dueDate !== f.dueDate) return false;
  const nfExpected = f.nf && /^\d+$/.test(f.nf) ? f.nf : null;
  if (parsed.notaFiscal !== nfExpected) return false;
  if (f.amount !== null) {
    if (parsed.valor === null || Math.abs(parsed.valor - f.amount) > 0.005) {
      return false;
    }
  }
  return true;
}
