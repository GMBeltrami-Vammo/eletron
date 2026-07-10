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

/** Today in São Paulo as ISO 'YYYY-MM-DD' (for the due-date-passed guard). */
export function fiscalTodayISO(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** How the send should treat one fatura. */
export type SendClass =
  | "registered" // already on the sheet → checked, not sent
  | "zero" // value 0 → paid + checked, not sent (decision #42 exception)
  | "noValor" // amount unknown → skip
  | "ignoredPast" // due-year ≤ SENDABLE_YEAR-1 → ignore
  | "blockedFuture" // due-year ≥ SENDABLE_YEAR+1 → block
  | "pastDue" // due date already passed → do not send
  | "naoCadastrado" // sem débito automático → manual
  | "semAba" // 2026 but the due-month tab does not exist
  | "send"; // eligible → append

/**
 * Decides how the send treats a fatura (pure, unit-tested). `todayIso` is the
 * São Paulo date. Order matters: value-0 wins over everything (even if on the
 * sheet — a R$0 bill is settled, not sent); then already-on-sheet; then the
 * year guard; then the due-date-passed guard; then the Cadastrado gate.
 */
export function classifyFaturaForSend(
  f: {
    registered: boolean;
    tabExists: boolean;
    amount: number | null;
    dueDate: string;
    autoDebit: string;
  },
  todayIso: string,
): SendClass {
  if (f.amount === 0) return "zero";
  if (f.registered) return "registered";
  if (f.amount === null) return "noValor";
  const year = Number(f.dueDate.slice(0, 4));
  if (!Number.isFinite(year) || year <= SENDABLE_YEAR - 1) return "ignoredPast";
  if (year >= SENDABLE_YEAR + 1) return "blockedFuture";
  if (f.dueDate < todayIso) return "pastDue";
  if (f.autoDebit !== "cadastrado") return "naoCadastrado";
  if (!f.tabExists) return "semAba";
  return "send";
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
