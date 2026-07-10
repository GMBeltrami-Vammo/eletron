/**
 * normalize.ts — THE only place raw sheet strings exist.
 *
 * Implements every data-quality rule from the appendix data model §5:
 * station-id sentinels, pt-BR/US money, explicit date-format lists (never
 * Date.parse), auto-debit de-accenting, portal-status fixed maps with
 * unknown-literal capture, multi-installation splits, month-matrix unpivots,
 * dedupe keys — and builds the full DomainSnapshot. Unparseable values become
 * NormalizationIssues; rows are never silently dropped.
 *
 * Pure TS (no Node-only imports) so vitest and future workers reuse it as-is.
 */

import {
  ACCOUNT_TYPE,
  ADJUSTMENT_INDEX,
  ADJUSTMENT_STATUS,
  AUTO_DEBIT_STATUS,
  CHARGE_KIND,
  CHARGE_LINE_KIND,
  CHARGE_STATUS,
  COMPETENCIA_SOURCE,
  CONTRACT_TYPE,
  COUNTERPARTY_KIND,
  INGEST_SOURCE,
  MATCH_STATUS,
  PAYMENT_METHOD,
  STATION_STATUS,
  UTILITY_BILL_STATUS,
  type AdjustmentIndex,
  type AdjustmentStatus,
  type AutoDebitStatus,
  type BillingAccount,
  type Charge,
  type ChargeEnergyDetails,
  type ChargeKind,
  type ChargeStatus,
  type ChargeLine,
  type Contract,
  type ContractType,
  type Counterparty,
  type DomainSnapshot,
  type MonthlyConsumption,
  type NormalizationIssue,
  type PaymentMethod,
  type RentAdjustment,
  type Station,
  type StationStatus,
  type UtilityAccountState,
  type UtilityBillStatus,
} from "@/lib/domain";
import {
  SHEET_ROW_KEY,
  sheetRowNumber,
  type RawRow,
  type RawTabs,
} from "./raw-tabs";

// ═══════════════════════════════════════════════════════════════════════════
// Small string helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Removes diacritics: 'Não' → 'Nao', 'Março' → 'Marco'. */
export function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const NBSP_RE = /[\u00a0\u202f]/g;

/** Trims + collapses NBSP variants to plain spaces. */
export function cleanCell(v: string | undefined | null): string {
  if (v == null) return "";
  return v.replace(NBSP_RE, " ").trim();
}

/** Strips a trailing '.0' (spreadsheet float renderings of integers). */
export function stripTrailingDotZero(v: string): string {
  return v.replace(/\.0+$/, "");
}

/** CNPJ/CPF → digits only; null when nothing digit-like survives. */
export function digitsOnly(v: string): string | null {
  const d = cleanCell(v).replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

/**
 * Canonical CPF/CNPJ for `counterparties.cnpj_cpf` (CHECK = exactly 11 or 14
 * digits). Sheets/Metabase store these as NUMBERS, so leading zeros are stripped
 * — a 13-digit value is a CNPJ that lost one zero (e.g. `1116871000138` →
 * `01116871000138`), a 10-digit value a CPF that lost one. Restore the zeros by
 * left-padding to the nearest valid width; only genuinely off-length garbage
 * (≤8 or 15+ digits) becomes null. Never fabricates a distinct key — padding is
 * deterministic, so the same real document always maps to the same id.
 */
export function normalizeCnpjCpf(raw: string): string | null {
  const d = digitsOnly(raw);
  if (d === null) return null;
  if (d.length === 11 || d.length === 14) return d;
  if (d.length === 12 || d.length === 13) return d.padStart(14, "0"); // CNPJ, zeros stripped
  if (d.length === 9 || d.length === 10) return d.padStart(11, "0"); // CPF, zeros stripped
  return null; // genuinely malformed
}

/**
 * Slugifies a name for deterministic entity ids ('Mc Donalds' → 'mc-donalds').
 * Exported so the Supabase read-repository reconstructs the SAME counterparty /
 * third-party account ids from DB columns (one canonical definition — the
 * parsing/derivation logic is otherwise reused verbatim).
 */
export function slug(v: string): string {
  return deaccent(v.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.1 — swap_station_id sentinels
// ═══════════════════════════════════════════════════════════════════════════

export interface StationIdResult {
  stationId: number | null;
  /** true when the cell was a known 'no station' sentinel (not an error). */
  sentinel: boolean;
  error: string | null;
}

/**
 * 'UNIDENTIFIED'/'Unidentified'/''/'N/A' → null (sentinel); trailing '.0'
 * stripped; anything non-integer → null + error (caller logs an issue).
 */
export function parseStationId(value: string): StationIdResult {
  const v = cleanCell(value);
  if (v === "" || /^(unidentified|n\/a|na)$/i.test(v)) {
    return { stationId: null, sentinel: true, error: null };
  }
  const stripped = stripTrailingDotZero(v);
  if (/^\d+$/.test(stripped)) {
    return { stationId: parseInt(stripped, 10), sentinel: false, error: null };
  }
  return {
    stationId: null,
    sentinel: false,
    error: `non-integer swap_station_id: '${value}'`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.3 — money / decimal numbers (pt-BR AND en-US renderings)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses money/decimal strings in either locale rendering:
 * pt-BR 'R$ 6.502,34' / 'R$48,58' / '1.042,29' and en-US 'R$1,200.00' /
 * '6,663.00' / '289.47' (the xlsx fixture renders numeric cells en-US).
 *
 * Disambiguation: with both separators the RIGHTMOST is the decimal mark;
 * with a single separator, 1–2 trailing digits → decimal, exactly 3 →
 * thousands. Returns null for empty/unparseable (never NaN).
 */
export function parseMoney(value: string): number | null {
  let s = cleanCell(value);
  if (s === "") return null;
  s = s.replace(/R\$/gi, "").replace(/\s+/g, "");
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decPos = Math.max(lastDot, lastComma);
    const intPart = s.slice(0, decPos).replace(/[.,]/g, "");
    const fracPart = s.slice(decPos + 1).replace(/[.,]/g, "");
    normalized = `${intPart}.${fracPart}`;
  } else if (lastComma >= 0) {
    const frac = s.slice(lastComma + 1);
    normalized =
      frac.length >= 1 && frac.length <= 2 && !frac.includes(",")
        ? `${s.slice(0, lastComma).replace(/,/g, "")}.${frac}`
        : s.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const frac = s.slice(lastDot + 1);
    normalized =
      frac.length >= 1 && frac.length <= 2 && !frac.includes(".")
        ? `${s.slice(0, lastDot).replace(/\./g, "")}.${frac}`
        : s.replace(/\./g, "");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? sign * n : null;
}

/** kWh and other plain decimals share the money disambiguation rules. */
export const parseDecimal = parseMoney;

export interface ParsedValorCell {
  kind: "empty" | "plain" | "labeled" | "unparseable";
  /** Documento/Boleto value — what the document actually charges. */
  amount: number | null;
  /** Planilha value — the contract/planilha expectation. */
  expectedAmount: number | null;
  /** Energia split (becomes an 'energia' charge line). */
  energyAmount: number | null;
  /** Locação split (Manager-style 'Boleto: X/ Locação: Y' cells). */
  rentAmount: number | null;
  unknownLabels: string[];
  raw: string;
}

/**
 * 2_Pagamentos Valor cells: plain money OR the polluted reconciliation text
 * 'Documento: X / Planilha: Y / Energia: Z' (variants observed in the sheet:
 * missing spaces before '/', 'Boleto: X/ Locação: Y', money-formatted values,
 * literal 'UNIDENTIFIED' as the Planilha value).
 */
export function parseValorCell(value: string): ParsedValorCell {
  const raw = cleanCell(value);
  const base: ParsedValorCell = {
    kind: "empty",
    amount: null,
    expectedAmount: null,
    energyAmount: null,
    rentAmount: null,
    unknownLabels: [],
    raw,
  };
  if (raw === "") return base;

  if (raw.includes(":")) {
    const pairRe = /([A-Za-zÀ-ÿ ]+?)\s*:\s*([^/]*)/g;
    let m: RegExpExecArray | null;
    let matched = false;
    while ((m = pairRe.exec(raw)) !== null) {
      matched = true;
      const label = deaccent(m[1].trim().toLowerCase());
      const val = m[2].trim();
      const num = parseMoney(val);
      switch (label) {
        case "documento":
        case "boleto":
          base.amount = num;
          break;
        case "planilha":
          base.expectedAmount = num;
          break;
        case "energia":
          base.energyAmount = num;
          break;
        case "locacao":
          base.rentAmount = num;
          break;
        default:
          base.unknownLabels.push(label);
      }
    }
    if (matched) {
      base.kind = "labeled";
      return base;
    }
  }

  const plain = parseMoney(raw);
  if (plain !== null) {
    return { ...base, kind: "plain", amount: plain };
  }
  return { ...base, kind: "unparseable" };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.2 — auto_debit
// ═══════════════════════════════════════════════════════════════════════════

export interface AutoDebitResult {
  status: AutoDebitStatus;
  /** true when a non-empty literal didn't match the fixed map (issue-worthy). */
  unknownLiteral: boolean;
}

/** 'Cadastrado'/'Não cadastrado'/'Nao Cadastrado' → enum; junk → desconhecido. */
export function parseAutoDebit(value: string): AutoDebitResult {
  const key = deaccent(cleanCell(value).toLowerCase());
  if (key === "cadastrado") {
    return { status: AUTO_DEBIT_STATUS.cadastrado, unknownLiteral: false };
  }
  if (key === "nao cadastrado") {
    return { status: AUTO_DEBIT_STATUS.naoCadastrado, unknownLiteral: false };
  }
  return {
    status: AUTO_DEBIT_STATUS.desconhecido,
    unknownLiteral: key !== "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.5 — dates (explicit format list; never Date.parse on raw strings)
// ═══════════════════════════════════════════════════════════════════════════

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): boolean {
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * Date formats accepted: ISO 'YYYY-MM-DD' (datetime prefixes tolerated),
 * 'DD/MM/YYYY', 'DD/MM/YY' (→ 20YY). Returns 'YYYY-MM-DD' or null.
 */
export function parseDateISO(value: string): string | null {
  const v = cleanCell(value);
  if (v === "") return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(v);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])];
    return validYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  return null;
}

/**
 * Timestamps: 'YYYY-MM-DD HH:mm[:ss]' (scraper, BRT wall clock) →
 * 'YYYY-MM-DDTHH:mm:ss'; full ISO with offset (backoffice created_at) passes
 * through unchanged; bare dates → 'T00:00:00'.
 */
export function parseTimestamp(value: string): string | null {
  const v = cleanCell(value);
  if (v === "") return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/.test(v)) {
    return v;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validYmd(y, mo, d)) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${pad2(Number(m[4]))}:${m[5]}:${m[6] ?? "00"}`;
  }
  const dateOnly = parseDateISO(v);
  return dateOnly ? `${dateOnly}T00:00:00` : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Month names / labels → competência
// ═══════════════════════════════════════════════════════════════════════════

/** pt-BR + English full month names, de-accented lowercase → month number. */
const MONTH_NAMES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** pt-BR 3-letter month abbreviations (uppercase) → month number. */
const MONTH_ABBREV: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};

/** 'Junho' + '2026' → '2026-06-01' (Mês/Ano columns of 2_Pagamentos). */
export function parseCompetenciaFromMesAno(
  mes: string,
  ano: string,
): string | null {
  const month = MONTH_NAMES[deaccent(cleanCell(mes).toLowerCase())];
  const yearStr = stripTrailingDotZero(cleanCell(ano));
  if (!month || !/^\d{4}$/.test(yearStr)) return null;
  return `${yearStr}-${pad2(month)}-01`;
}

/**
 * negotiated_invoices entries: 'Março/26', 'January/26', 'dezembro/25' →
 * 'YYYY-MM'. Mixed pt/English casings exist in the sheet.
 */
export function parseMonthYearLabel(label: string): string | null {
  const m = /^([A-Za-zÀ-ÿ]+)\s*\/\s*(\d{2}|\d{4})$/.exec(cleanCell(label));
  if (!m) return null;
  const month = MONTH_NAMES[deaccent(m[1].toLowerCase())];
  if (!month) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${year}-${pad2(month)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.4 — coordinates (comma vs dot decimals, detected per value)
// ═══════════════════════════════════════════════════════════════════════════

export function parseCoordinate(value: string): number | null {
  let v = cleanCell(value);
  if (v === "") return null;
  // enel_data/edp_data use comma decimals, Vammo_data uses dots.
  if (v.includes(",") && !v.includes(".")) v = v.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.9 — portal bill status (fixed map + unknown-literal capture)
// ═══════════════════════════════════════════════════════════════════════════

const BILL_STATUS_MAP: Record<string, UtilityBillStatus> = {
  paga: UTILITY_BILL_STATUS.paga,
  pendente: UTILITY_BILL_STATUS.pendente,
  "a vencer": UTILITY_BILL_STATUS.aVencer,
  vencida: UTILITY_BILL_STATUS.vencida,
  "sem contas": UTILITY_BILL_STATUS.semContas,
  "em compensacao": UTILITY_BILL_STATUS.emCompensacao,
  "fatura negociada": UTILITY_BILL_STATUS.faturaNegociada,
  "n/a": UTILITY_BILL_STATUS.na,
  na: UTILITY_BILL_STATUS.na,
};

export interface BillStatusResult {
  status: UtilityBillStatus | null;
  raw: string;
  /** true when a non-empty literal is not in the fixed map (new portal state). */
  unknownLiteral: boolean;
}

export function parseBillStatus(value: string): BillStatusResult {
  const raw = cleanCell(value);
  if (raw === "") return { status: null, raw, unknownLiteral: false };
  const status = BILL_STATUS_MAP[deaccent(raw.toLowerCase())];
  if (status !== undefined) return { status, raw, unknownLiteral: false };
  return { status: null, raw, unknownLiteral: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.11 — multi-installation comma-joined lists
// ═══════════════════════════════════════════════════════════════════════════

/** Splits ', '-joined parallel lists ('Enel, Enel' / '204454589, 204543107'). */
export function splitMultiValue(value: string): string[] {
  const v = cleanCell(value);
  if (v === "") return [];
  return v.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

export interface ZippedInstallation {
  installationId: string;
  provider: string;
  autoDebit: AutoDebitStatus;
}

/**
 * Vammo_data multi-installation columns: installation_id / provider /
 * has_auto_debit are ', '-joined PARALLEL lists — zip them positionally.
 * Shorter provider/auto-debit lists fall back to their first entry (single
 * values apply to every installation); `lengthMismatch` flags real skew.
 */
export function zipInstallations(row: RawRow): {
  installations: ZippedInstallation[];
  lengthMismatch: boolean;
} {
  const ids = splitMultiValue(row["installation_id"] ?? "");
  const providers = splitMultiValue(row["provider"] ?? "");
  const autoDebits = splitMultiValue(row["has_auto_debit"] ?? "");
  const lengthMismatch =
    (providers.length > 1 && providers.length !== ids.length) ||
    (autoDebits.length > 1 && autoDebits.length !== ids.length);
  return {
    installations: ids.map((installationId, i) => ({
      installationId,
      provider: (providers[i] ?? providers[0] ?? "").toLowerCase(),
      autoDebit: parseAutoDebit(autoDebits[i] ?? autoDebits[0] ?? "").status,
    })),
    lengthMismatch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Month-matrix unpivot (ENEL F_/R_ uppercase; EDP lowercase mmmaa)
// ═══════════════════════════════════════════════════════════════════════════

const ENEL_MONTH_HEADER = /^([FR])_([A-Z]{3})(\d{2})$/;
// Strictly lowercase: the sheet also carries stale English-named duplicates
// ('Jun26', 'May26') that must NOT be unpivoted (they'd double-count).
const EDP_MONTH_HEADER = /^([a-z]{3})(\d{2})$/;

export interface MonthCell {
  /** 'YYYY-MM-01'. */
  competencia: string;
  kind: "billed" | "recorded";
  value: number | null;
  header: string;
  rawValue: string;
}

/** enel_data F_MMMAA (billed) / R_MMMAA (recorded) columns → month cells. */
export function unpivotEnelMonths(row: RawRow): MonthCell[] {
  const out: MonthCell[] = [];
  for (const [header, rawValue] of Object.entries(row)) {
    const m = ENEL_MONTH_HEADER.exec(header);
    if (!m) continue;
    const month = MONTH_ABBREV[m[2]];
    if (!month) continue;
    if (cleanCell(rawValue) === "") continue;
    out.push({
      competencia: `${2000 + Number(m[3])}-${pad2(month)}-01`,
      kind: m[1] === "F" ? "billed" : "recorded",
      value: parseDecimal(rawValue),
      header,
      rawValue,
    });
  }
  return out;
}

/** edp_data lowercase 'mmmaa' consumo columns → month cells (billed only). */
export function unpivotEdpMonths(row: RawRow): MonthCell[] {
  const out: MonthCell[] = [];
  for (const [header, rawValue] of Object.entries(row)) {
    const m = EDP_MONTH_HEADER.exec(header);
    if (!m) continue;
    const month = MONTH_ABBREV[m[1].toUpperCase()];
    if (!month) continue;
    if (cleanCell(rawValue) === "") continue;
    out.push({
      competencia: `${2000 + Number(m[2])}-${pad2(month)}-01`,
      kind: "billed",
      value: parseDecimal(rawValue),
      header,
      rawValue,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Misc cell parsers
// ═══════════════════════════════════════════════════════════════════════════

/** '=HYPERLINK("url";"label")' (also ',' separator) → url; bare urls pass. */
export function extractHyperlinkUrl(value: string): string | null {
  const v = cleanCell(value);
  if (v === "") return null;
  const m = /^=?\s*HYPERLINK\(\s*"([^"]+)"\s*[;,]/i.exec(v);
  if (m) return m[1];
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}

/** 'TRUE'/'FALSE' checkbox cells (any casing). */
export function parseBoolean(value: string): boolean | null {
  const v = cleanCell(value).toLowerCase();
  if (v === "true" || v === "verdadeiro") return true;
  if (v === "false" || v === "falso") return false;
  return null;
}

export interface ShutdownParts {
  date: string | null;
  start: string | null;
  end: string | null;
}

/** ENEL shutdown cells: '2026-07-12 10:00 16:00' → date + start + end. */
export function parseShutdown(value: string): ShutdownParts {
  const v = cleanCell(value);
  if (v === "") return { date: null, start: null, end: null };
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?(?:\s+(\d{1,2}:\d{2}))?$/.exec(v);
  if (!m) {
    const dateOnly = parseDateISO(v);
    return { date: dateOnly, start: null, end: null };
  }
  return { date: m[1], start: m[2] ?? null, end: m[3] ?? null };
}

/** Leading ISO date of an 'Ultimo Comprovante' cell ('2026-07-03 - Page 1 ...'). */
export function extractLeadingIsoDate(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(cleanCell(value));
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dedupe keys (§5.7)
// ═══════════════════════════════════════════════════════════════════════════

export function enelChargeDedupeKey(enelId: string, dueDate: string | null): string {
  return `enel:${enelId}:${dueDate ?? "na"}`;
}

export function edpChargeDedupeKey(uc: string, dueDate: string | null): string {
  return `edp:${uc}:${dueDate ?? "na"}`;
}

export function pagamentosChargeDedupeKey(
  cadastroId: number | null,
  competencia: string | null,
  kind: ChargeKind,
): string {
  const comp = competencia ? competencia.slice(0, 7) : "na";
  return `pag:${cadastroId ?? "unidentified"}:${comp}:${kind}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Enum literal maps for the rent sheet
// ═══════════════════════════════════════════════════════════════════════════

/** Deaccented/lowercased "Tipo de Contrato" → enum (shared with contratos.ts). */
export const CONTRACT_TYPE_MAP: Record<string, ContractType> = {
  "por box": CONTRACT_TYPE.porBox,
  fixo: CONTRACT_TYPE.fixo,
  "por box c/ minimo": CONTRACT_TYPE.porBoxMinimo,
  gratuito: CONTRACT_TYPE.gratuito,
  "casa vammo": CONTRACT_TYPE.casaVammo,
};

/** Deaccented/lowercased "Tipo de Pagamento" → enum (shared with cobrancas.ts). */
export const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  pix: PAYMENT_METHOD.pix,
  "boleto (celular)": PAYMENT_METHOD.boletoCelular,
  "boleto (email)": PAYMENT_METHOD.boletoEmail,
  transferencia: PAYMENT_METHOD.transferencia,
  "debito automatico": PAYMENT_METHOD.debitoAutomatico,
};

const STATION_STATUS_MAP: Record<string, StationStatus> = {
  ACTIVE: STATION_STATUS.ACTIVE,
  INACTIVE: STATION_STATUS.INACTIVE,
  DECOMMISSIONED: STATION_STATUS.DECOMMISSIONED,
  PRE_INSTALLATION: STATION_STATUS.PRE_INSTALLATION,
};

/** Deaccented/lowercased "Tipo de Cobrança" → enum (shared with cobrancas.ts). */
export const CHARGE_KIND_MAP: Record<string, ChargeKind> = {
  aluguel: CHARGE_KIND.aluguel,
  energia: CHARGE_KIND.energia,
  "aluguel + energia": CHARGE_KIND.aluguelEnergia,
};

const ADJUSTMENT_INDEX_MAP: Record<string, AdjustmentIndex> = {
  igpm: ADJUSTMENT_INDEX.igpm,
  ipca: ADJUSTMENT_INDEX.ipca,
  inpc: ADJUSTMENT_INDEX.inpc,
};

const ADJUSTMENT_STATUS_MAP: Record<string, AdjustmentStatus> = {
  pendente: ADJUSTMENT_STATUS.pendente,
  negociando: ADJUSTMENT_STATUS.negociando,
  aplicado: ADJUSTMENT_STATUS.aplicado,
  recusado: ADJUSTMENT_STATUS.recusado,
};

// ═══════════════════════════════════════════════════════════════════════════
// normalizeSnapshot
// ═══════════════════════════════════════════════════════════════════════════

function stripRowKey(row: RawRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== SHEET_ROW_KEY) out[k] = v;
  }
  return out;
}

class IssueCollector {
  readonly issues: NormalizationIssue[] = [];
  add(
    tab: string,
    rowNumber: number,
    column: string | null,
    code: NormalizationIssue["code"],
    message: string,
    rawValue: string | null = null,
  ): void {
    this.issues.push({ tab, rowNumber, column, code, message, rawValue });
  }
}

function parseIntCell(value: string): number | null {
  const v = stripTrailingDotZero(cleanCell(value));
  if (!/^-?\d+$/.test(v)) return null;
  return parseInt(v, 10);
}

/** Builds the whole normalized domain snapshot from raw tab rows. */
export function normalizeSnapshot(raw: RawTabs): DomainSnapshot {
  const issues = new IssueCollector();

  const stations: Station[] = [];
  const counterparties = new Map<string, Counterparty>();
  const contracts: Contract[] = [];
  const accounts = new Map<string, BillingAccount>();
  const states: UtilityAccountState[] = [];
  const consumption: MonthlyConsumption[] = [];
  const charges: Charge[] = [];
  const chargeLines: ChargeLine[] = [];
  const energyDetails: ChargeEnergyDetails[] = [];
  const adjustments: RentAdjustment[] = [];

  // ── Stations (Vammo_data) ────────────────────────────────────────────────
  const stationIds = new Set<number>();
  raw["Vammo_data"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const idResult = parseStationId(row["swap_station_id"] ?? "");
    if (idResult.stationId === null) {
      issues.add(
        "Vammo_data", rowNo, "swap_station_id", "invalid_station_id",
        idResult.error ?? "blank swap_station_id in Vammo_data",
        row["swap_station_id"] ?? null,
      );
      return;
    }
    const statusRaw = cleanCell(row["status"] ?? "");
    const status = STATION_STATUS_MAP[statusRaw] ?? null;
    if (status === null && statusRaw !== "") {
      issues.add(
        "Vammo_data", rowNo, "status", "unknown_enum_literal",
        `unknown station status '${statusRaw}'`, statusRaw,
      );
    } else if (statusRaw === "") {
      issues.add(
        "Vammo_data", rowNo, "status", "invalid_value",
        `station ${idResult.stationId} has blank status`, "",
      );
    }
    stationIds.add(idResult.stationId);
    stations.push({
      id: idResult.stationId,
      name: cleanCell(row["swap_station_name"] ?? "") || null,
      address: cleanCell(row["address"] ?? "") || null,
      latitude: parseCoordinate(row["latitude"] ?? ""),
      longitude: parseCoordinate(row["longitude"] ?? ""),
      status,
      sourceCreatedAt: parseTimestamp(row["created_at"] ?? ""),
      // sheets have no hide column — the Supabase-only flag defaults false here.
      hidden: false,
      raw: stripRowKey(row),
    });
  });

  // ── Counterparty helper (1_Cadastro + 2_Pagamentos share it) ─────────────
  function upsertCounterparty(
    name: string,
    cnpjRaw: string,
    kind: Counterparty["kind"],
  ): string | null {
    const cleanName = cleanCell(name);
    // Restore stripped leading zeros so a real CNPJ/CPF passes the DB CHECK
    // (a 13-digit sheet value is a CNPJ missing a zero, not garbage); truly
    // off-length values fall back to a name key. Fixes the clone-aborting
    // "counterparties_cnpj_cpf_check" violation.
    const cnpj = normalizeCnpjCpf(cnpjRaw);
    if (!cleanName && !cnpj) return null;
    const id = cnpj ? `cp:${cnpj}` : `cp:name:${slug(cleanName)}`;
    const existing = counterparties.get(id);
    if (!existing) {
      counterparties.set(id, {
        id,
        name: cleanName || (cnpj as string),
        cnpjCpf: cnpj,
        kind,
        notes: null,
      });
    } else if (!existing.name && cleanName) {
      existing.name = cleanName;
    }
    return id;
  }

  // ── Contracts + rent accounts (1_Cadastro) ───────────────────────────────
  const contractsByStation = new Map<number, Contract[]>();
  raw["1_Cadastro"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const cadastroId = parseIntCell(row["cadastro_id"] ?? "");
    if (cadastroId === null) {
      issues.add(
        "1_Cadastro", rowNo, "cadastro_id", "invalid_cadastro_id",
        `non-integer cadastro_id '${row["cadastro_id"] ?? ""}'`,
        row["cadastro_id"] ?? null,
      );
      return;
    }
    const idResult = parseStationId(row["swap_station_id"] ?? "");
    if (idResult.error) {
      issues.add(
        "1_Cadastro", rowNo, "swap_station_id", "invalid_station_id",
        idResult.error, row["swap_station_id"] ?? null,
      );
    }
    const statusRaw = cleanCell(row["Status"] ?? "");
    const status = STATION_STATUS_MAP[statusRaw] ?? null;
    if (status === null && statusRaw !== "") {
      issues.add(
        "1_Cadastro", rowNo, "Status", "unknown_enum_literal",
        `unknown Status_Locacao '${statusRaw}'`, statusRaw,
      );
    }
    const typeRaw = deaccent(cleanCell(row["Tipo_Contrato"] ?? "").toLowerCase());
    const contractType = CONTRACT_TYPE_MAP[typeRaw] ?? null;
    if (contractType === null && typeRaw !== "") {
      issues.add(
        "1_Cadastro", rowNo, "Tipo_Contrato", "unknown_enum_literal",
        `unknown Tipo_Contrato '${row["Tipo_Contrato"]}'`, row["Tipo_Contrato"],
      );
    }
    const payRaw = deaccent(cleanCell(row["Tipo de Pagamento"] ?? "").toLowerCase());
    let paymentMethod: PaymentMethod | null = PAYMENT_METHOD_MAP[payRaw] ?? null;
    if (paymentMethod === null && payRaw !== "") {
      paymentMethod = PAYMENT_METHOD.outro;
      issues.add(
        "1_Cadastro", rowNo, "Tipo de Pagamento", "unknown_enum_literal",
        `unknown Tipo de Pagamento '${row["Tipo de Pagamento"]}' → outro`,
        row["Tipo de Pagamento"],
      );
    }
    const dueDay = parseIntCell(row["Vencimento (dia)"] ?? "");
    if (dueDay !== null && (dueDay < 1 || dueDay > 31)) {
      issues.add(
        "1_Cadastro", rowNo, "Vencimento (dia)", "invalid_value",
        `due day out of range: ${dueDay}`, row["Vencimento (dia)"],
      );
    }
    const counterpartyId = upsertCounterparty(
      row["Parceiro / Locador"] ?? "",
      row["CNPJ/CPF"] ?? "",
      COUNTERPARTY_KIND.locador,
    );

    const contract: Contract = {
      id: `contract:${cadastroId}`,
      cadastroId,
      stationId: idResult.stationId,
      counterpartyId,
      status,
      address: cleanCell(row["Endereço"] ?? "") || null,
      contactName: cleanCell(row["Contato (nome)"] ?? "") || null,
      phone: cleanCell(row["Telefone"] ?? "") || null,
      email: cleanCell(row["E-mail"] ?? "") || null,
      enelConnectionNumber: cleanCell(row["Número da Conexão"] ?? "") || null,
      contractType,
      boxCount: parseIntCell(row["Box_Contrato"] ?? ""),
      minBox: parseIntCell(row["Min_Box"] ?? ""),
      valorPorBox: parseMoney(row["Valor/Box (R$)"] ?? ""),
      valorMensal: parseMoney(row["Valor_Mensal (R$)"] ?? ""),
      dueDay: dueDay !== null && dueDay >= 1 && dueDay <= 31 ? dueDay : null,
      paymentMethod,
      banco: cleanCell(row["Banco"] ?? "") || null,
      agencia: cleanCell(row["Agência"] ?? "") || null,
      conta: cleanCell(row["Conta"] ?? "") || null,
      chavePix: cleanCell(row["Chave Pix"] ?? "") || null,
      startsOn: parseDateISO(row["Início Contrato"] ?? ""),
      endsOn: parseDateISO(row["Fim Contrato"] ?? ""),
      observations: cleanCell(row["Observação"] ?? "") || null,
      raw: stripRowKey(row),
    };
    contracts.push(contract);
    if (contract.stationId !== null) {
      const list = contractsByStation.get(contract.stationId) ?? [];
      list.push(contract);
      contractsByStation.set(contract.stationId, list);
    }

    accounts.set(`rent:${cadastroId}`, {
      id: `rent:${cadastroId}`,
      stationId: idResult.stationId,
      accountType: ACCOUNT_TYPE.rent,
      enelId: null,
      edpUc: null,
      edpContractId: null,
      contractId: contract.id,
      counterpartyId,
      externalRef: null,
      autoDebitRegistration: null,
      matchStatus:
        idResult.stationId !== null
          ? MATCH_STATUS.manuallyMatched
          : MATCH_STATUS.unmatched,
      isActive: status === STATION_STATUS.ACTIVE,
      notes: null,
    });
  });

  // ── ENEL accounts + state + consumption (enel_data) ──────────────────────
  raw["enel_data"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const enelId = cleanCell(row["enel_id"] ?? "");
    if (enelId === "") {
      issues.add(
        "enel_data", rowNo, "enel_id", "missing_key",
        "enel_data row without enel_id", null,
      );
      return;
    }
    const idResult = parseStationId(row["swap_station_id"] ?? "");
    if (idResult.error) {
      issues.add(
        "enel_data", rowNo, "swap_station_id", "invalid_station_id",
        idResult.error, row["swap_station_id"] ?? null,
      );
    }
    const autoDebit = parseAutoDebit(row["auto_debit"] ?? "");
    if (autoDebit.unknownLiteral) {
      issues.add(
        "enel_data", rowNo, "auto_debit", "unknown_auto_debit",
        `unknown auto_debit literal '${row["auto_debit"]}' → desconhecido`,
        row["auto_debit"],
      );
    }
    const billStatus = parseBillStatus(row["status"] ?? "");
    if (billStatus.unknownLiteral) {
      issues.add(
        "enel_data", rowNo, "status", "unknown_bill_status",
        `unknown portal status literal '${billStatus.raw}'`, billStatus.raw,
      );
    }
    const accountId = `enel:${enelId}`;
    accounts.set(accountId, {
      id: accountId,
      stationId: idResult.stationId,
      accountType: ACCOUNT_TYPE.energyEnel,
      enelId,
      edpUc: null,
      edpContractId: null,
      contractId: null,
      counterpartyId: null,
      externalRef: null,
      autoDebitRegistration: cleanCell(row["auto_debit_registration"] ?? "") || null,
      matchStatus:
        idResult.stationId !== null
          ? MATCH_STATUS.autoMatched
          : MATCH_STATUS.unmatched,
      isActive: true,
      notes: null,
    });

    const negotiatedRaw = splitMultiValue(row["negotiated_invoices"] ?? "");
    const negotiatedCompetencias: string[] = [];
    for (const label of negotiatedRaw) {
      const comp = parseMonthYearLabel(label);
      if (comp) {
        negotiatedCompetencias.push(comp);
      } else {
        issues.add(
          "enel_data", rowNo, "negotiated_invoices", "unparseable_competencia",
          `unparseable negotiated invoice label '${label}'`, label,
        );
      }
    }
    const historyRaw = splitMultiValue(row["invoice_history"] ?? "");
    const historyStatuses = historyRaw.map((h) => parseBillStatus(h).status);

    const shutdown = parseShutdown(row["shutdown_date"] ?? "");
    const lastBillingRaw = cleanCell(row["last_billing"] ?? "");
    const lastBilling = parseMoney(lastBillingRaw);
    if (lastBilling === null && lastBillingRaw !== "") {
      issues.add(
        "enel_data", rowNo, "last_billing", "unparseable_money",
        `unparseable last_billing '${lastBillingRaw}'`, lastBillingRaw,
      );
    }

    states.push({
      billingAccountId: accountId,
      providerStationStatus: cleanCell(row["station_status"] ?? "") || null,
      address: cleanCell(row["address"] ?? "") || null,
      neighborhood: null,
      city: null,
      billStatus: billStatus.status,
      billStatusRaw: billStatus.raw || null,
      lastBilling,
      dueDate: parseDateISO(row["due_date"] ?? ""),
      autoDebit: autoDebit.status,
      autoDebitRegistration: cleanCell(row["auto_debit_registration"] ?? "") || null,
      accountEmail: cleanCell(row["email"] ?? "") || null,
      negotiatedInvoices: negotiatedRaw,
      negotiatedCompetencias,
      invoiceHistory: historyRaw,
      invoiceHistoryStatuses: historyStatuses,
      shutdownDate: shutdown.date,
      shutdownStart: shutdown.start,
      shutdownEnd: shutdown.end,
      firstSeenAt: parseTimestamp(row["first_seen_time"] ?? ""),
      scrapedAt: parseTimestamp(row["scraping_time"] ?? ""),
      lat: parseCoordinate(row["lat"] ?? ""),
      lon: parseCoordinate(row["lon"] ?? ""),
      ultimaFaturaFlag: cleanCell(row["Ultima Fatura"] ?? "") || null,
      ultimoComprovante: cleanCell(row["Ultimo Comprovante"] ?? "") || null,
      ultimoComprovanteDate: extractLeadingIsoDate(row["Ultimo Comprovante"] ?? ""),
      isStatusCarriedForward: billStatus.status === UTILITY_BILL_STATUS.semContas,
      raw: stripRowKey(row),
    });

    const byMonth = new Map<string, { billed: number | null; recorded: number | null }>();
    for (const cell of unpivotEnelMonths(row)) {
      if (cell.value === null) {
        issues.add(
          "enel_data", rowNo, cell.header, "invalid_value",
          `unparseable consumption '${cell.rawValue}'`, cell.rawValue,
        );
        continue;
      }
      const entry = byMonth.get(cell.competencia) ?? { billed: null, recorded: null };
      if (cell.kind === "billed") entry.billed = cell.value;
      else entry.recorded = cell.value;
      byMonth.set(cell.competencia, entry);
    }
    for (const [competencia, entry] of byMonth) {
      consumption.push({
        billingAccountId: accountId,
        competencia,
        kwhBilled: entry.billed,
        kwhRecorded: entry.recorded,
        source: INGEST_SOURCE.scraperEnel,
      });
    }
  });

  // ── EDP accounts + state + consumption (edp_data) ────────────────────────
  raw["edp_data"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const uc = cleanCell(row["uc"] ?? "");
    if (uc === "") {
      issues.add(
        "edp_data", rowNo, "uc", "missing_key",
        "edp_data row without uc", null,
      );
      return;
    }
    const idResult = parseStationId(row["swap_station_id"] ?? "");
    if (idResult.error) {
      issues.add(
        "edp_data", rowNo, "swap_station_id", "invalid_station_id",
        idResult.error, row["swap_station_id"] ?? null,
      );
    }
    const autoDebit = parseAutoDebit(row["auto_debit"] ?? "");
    if (autoDebit.unknownLiteral) {
      issues.add(
        "edp_data", rowNo, "auto_debit", "unknown_auto_debit",
        `unknown auto_debit literal '${row["auto_debit"]}' → desconhecido`,
        row["auto_debit"],
      );
    }
    const billStatus = parseBillStatus(row["status"] ?? "");
    if (billStatus.unknownLiteral) {
      issues.add(
        "edp_data", rowNo, "status", "unknown_bill_status",
        `unknown portal status literal '${billStatus.raw}'`, billStatus.raw,
      );
    }
    const accountId = `edp:${uc}`;
    accounts.set(accountId, {
      id: accountId,
      stationId: idResult.stationId,
      accountType: ACCOUNT_TYPE.energyEdp,
      enelId: null,
      edpUc: uc,
      edpContractId: cleanCell(row["edp_id"] ?? "") || null,
      contractId: null,
      counterpartyId: null,
      externalRef: null,
      autoDebitRegistration: cleanCell(row["auto_debit_registration"] ?? "") || null,
      matchStatus:
        idResult.stationId !== null
          ? MATCH_STATUS.autoMatched
          : MATCH_STATUS.unmatched,
      isActive: true,
      notes: null,
    });

    const lastBillingRaw = cleanCell(row["last_billing"] ?? "");
    const lastBilling = parseMoney(lastBillingRaw);
    if (lastBilling === null && lastBillingRaw !== "") {
      issues.add(
        "edp_data", rowNo, "last_billing", "unparseable_money",
        `unparseable last_billing '${lastBillingRaw}'`, lastBillingRaw,
      );
    }

    states.push({
      billingAccountId: accountId,
      providerStationStatus: cleanCell(row["station_status"] ?? "") || null,
      address: cleanCell(row["address"] ?? "") || null,
      neighborhood: cleanCell(row["neighborhood"] ?? "") || null,
      city: cleanCell(row["city"] ?? "") || null,
      billStatus: billStatus.status,
      billStatusRaw: billStatus.raw || null,
      lastBilling,
      dueDate: parseDateISO(row["due_date"] ?? ""),
      autoDebit: autoDebit.status,
      autoDebitRegistration: cleanCell(row["auto_debit_registration"] ?? "") || null,
      accountEmail: cleanCell(row["email"] ?? "") || null,
      negotiatedInvoices: [],
      negotiatedCompetencias: [],
      invoiceHistory: [],
      invoiceHistoryStatuses: [],
      shutdownDate: null,
      shutdownStart: null,
      shutdownEnd: null,
      firstSeenAt: parseTimestamp(row["first_seen_time"] ?? ""),
      scrapedAt: parseTimestamp(row["scraping_time"] ?? ""),
      lat: parseCoordinate(row["lat"] ?? ""),
      lon: parseCoordinate(row["lon"] ?? ""),
      ultimaFaturaFlag: cleanCell(row["Ultima Fatura"] ?? "") || null,
      ultimoComprovante: cleanCell(row["Ultimo Comprovante"] ?? "") || null,
      ultimoComprovanteDate: extractLeadingIsoDate(row["Ultimo Comprovante"] ?? ""),
      isStatusCarriedForward: billStatus.status === UTILITY_BILL_STATUS.semContas,
      raw: stripRowKey(row),
    });

    for (const cell of unpivotEdpMonths(row)) {
      if (cell.value === null) {
        issues.add(
          "edp_data", rowNo, cell.header, "invalid_value",
          `unparseable consumption '${cell.rawValue}'`, cell.rawValue,
        );
        continue;
      }
      consumption.push({
        billingAccountId: accountId,
        competencia: cell.competencia,
        kwhBilled: cell.value,
        kwhRecorded: null,
        source: INGEST_SOURCE.scraperEdp,
      });
    }
  });

  // ── Vammo_data multi-installation merge (§5.11) ──────────────────────────
  // installation_id/provider/has_auto_debit are ', '-joined parallel lists.
  // enel_data/edp_data are the authoritative account sources; installations
  // listed only in Vammo_data become accounts too (never dropped).
  raw["Vammo_data"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const idResult = parseStationId(row["swap_station_id"] ?? "");
    if (idResult.stationId === null) return; // already reported above
    const { installations, lengthMismatch } = zipInstallations(row);
    if (installations.length === 0) return;
    if (lengthMismatch) {
      issues.add(
        "Vammo_data", rowNo, "installation_id", "zip_length_mismatch",
        `provider/has_auto_debit list lengths do not match installation_id list (${installations.length})`,
        row["installation_id"],
      );
    }
    for (const inst of installations) {
      if (!/^\d+$/.test(stripTrailingDotZero(inst.installationId))) {
        issues.add(
          "Vammo_data", rowNo, "installation_id", "invalid_value",
          `non-numeric installation_id '${inst.installationId}' (provider '${inst.provider}')`,
          inst.installationId,
        );
        continue;
      }
      const instId = stripTrailingDotZero(inst.installationId);
      if (inst.provider === "enel") {
        if (accounts.has(`enel:${instId}`)) continue;
        accounts.set(`enel:${instId}`, {
          id: `enel:${instId}`,
          stationId: idResult.stationId,
          accountType: ACCOUNT_TYPE.energyEnel,
          enelId: instId,
          edpUc: null,
          edpContractId: null,
          contractId: null,
          counterpartyId: null,
          externalRef: null,
          autoDebitRegistration: null,
          matchStatus: MATCH_STATUS.autoMatched,
          isActive: true,
          notes: `listada só no Vammo_data (sem linha no enel_data); has_auto_debit: ${inst.autoDebit}`,
        });
      } else if (inst.provider === "edp") {
        const existsByUcOrContract = Array.from(accounts.values()).some(
          (a) =>
            a.accountType === ACCOUNT_TYPE.energyEdp &&
            (a.edpUc === instId || a.edpContractId === instId),
        );
        if (existsByUcOrContract) continue;
        accounts.set(`edp:${instId}`, {
          id: `edp:${instId}`,
          stationId: idResult.stationId,
          accountType: ACCOUNT_TYPE.energyEdp,
          enelId: null,
          edpUc: instId,
          edpContractId: null,
          contractId: null,
          counterpartyId: null,
          externalRef: null,
          autoDebitRegistration: null,
          matchStatus: MATCH_STATUS.autoMatched,
          isActive: true,
          notes: `listada só no Vammo_data (sem linha no edp_data); has_auto_debit: ${inst.autoDebit}`,
        });
      }
    }
  });

  // ── Charges: Faturas_ENEL / Faturas_EDP ──────────────────────────────────
  const seenChargeKeys = new Set<string>();

  // Portal bill status → charge status (decision #21: the fiscal-export flag
  // never implies paid). 'sem_contas' is absent → falls through to 'pendente'.
  const billStatusToCharge: Partial<Record<UtilityBillStatus, ChargeStatus>> = {
    [UTILITY_BILL_STATUS.paga]: CHARGE_STATUS.pago,
    [UTILITY_BILL_STATUS.vencida]: CHARGE_STATUS.atrasado,
    [UTILITY_BILL_STATUS.pendente]: CHARGE_STATUS.pendente,
    [UTILITY_BILL_STATUS.aVencer]: CHARGE_STATUS.pendente,
    [UTILITY_BILL_STATUS.emCompensacao]: CHARGE_STATUS.emCompensacao,
    [UTILITY_BILL_STATUS.faturaNegociada]: CHARGE_STATUS.negociada,
    [UTILITY_BILL_STATUS.na]: CHARGE_STATUS.naoAplicavel,
  };

  function pushUtilityCharge(
    tab: "Faturas_ENEL" | "Faturas_EDP",
    row: RawRow,
    rowNo: number,
  ): void {
    const isEnel = tab === "Faturas_ENEL";
    const keyColumn = isEnel ? "enel_id" : "uc";
    const externalId = cleanCell(row[keyColumn] ?? "");
    if (externalId === "") {
      issues.add(tab, rowNo, keyColumn, "missing_key", `${tab} row without ${keyColumn}`, null);
      return;
    }
    const dueDate = parseDateISO(row["due_date"] ?? "");
    if (dueDate === null && cleanCell(row["due_date"] ?? "") !== "") {
      issues.add(
        tab, rowNo, "due_date", "unparseable_date",
        `unparseable due_date '${row["due_date"]}'`, row["due_date"],
      );
    }
    const dedupeKey = isEnel
      ? enelChargeDedupeKey(externalId, dueDate)
      : edpChargeDedupeKey(externalId, dueDate);
    if (seenChargeKeys.has(dedupeKey)) {
      issues.add(
        tab, rowNo, null, "duplicate_dedupe_key",
        `duplicate invoice row for ${dedupeKey} — kept first occurrence`,
        dedupeKey,
      );
      return;
    }
    seenChargeKeys.add(dedupeKey);

    const accountId = isEnel ? `enel:${externalId}` : `edp:${externalId}`;
    let account = accounts.get(accountId);
    if (!account) {
      // Unseen id: auto-create an unmatched account (Phase 2 sync behavior).
      issues.add(
        tab, rowNo, keyColumn, "missing_account",
        `${keyColumn} '${externalId}' has no ${isEnel ? "enel_data" : "edp_data"} row — account auto-created unmatched`,
        externalId,
      );
      account = {
        id: accountId,
        stationId: null,
        accountType: isEnel ? ACCOUNT_TYPE.energyEnel : ACCOUNT_TYPE.energyEdp,
        enelId: isEnel ? externalId : null,
        edpUc: isEnel ? null : externalId,
        edpContractId: null,
        contractId: null,
        counterpartyId: null,
        externalRef: null,
        autoDebitRegistration: null,
        matchStatus: MATCH_STATUS.unmatched,
        isActive: true,
        notes: null,
      };
      accounts.set(accountId, account);
    }

    const amountRaw = cleanCell(row["value"] ?? "");
    const amount = parseMoney(amountRaw);
    if (amount === null && amountRaw !== "") {
      issues.add(
        tab, rowNo, "value", "unparseable_money",
        `unparseable invoice value '${amountRaw}'`, amountRaw,
      );
    }
    const fiscalExported = parseBoolean(row["Financeiro Check"] ?? "") ?? false;
    const autoDebit = parseAutoDebit(row["auto_debit"] ?? "");
    const competencia = dueDate ? `${dueDate.slice(0, 7)}-01` : null;

    // Status derivation (decision #21): NEVER from the fiscal-export flag.
    // Precedence: per-row receipt link → pago; decision #16 EDP receipted-by-due
    // → pago; else the current bill's portal status; else honest 'pendente' for
    // historical rows with no paid signal.
    const state = stateByAccountId.get(account.id);
    const hasComprovante = cleanCell(row["Comprovante"] ?? "") !== "";
    let status: ChargeStatus;
    if (hasComprovante) {
      status = CHARGE_STATUS.pago;
    } else if (
      !isEnel &&
      state?.ultimoComprovanteDate &&
      dueDate !== null &&
      state.ultimoComprovanteDate >= dueDate
    ) {
      status = CHARGE_STATUS.pago;
    } else if (
      state &&
      state.dueDate !== null &&
      dueDate !== null &&
      state.dueDate === dueDate &&
      state.billStatus !== null
    ) {
      status = billStatusToCharge[state.billStatus] ?? CHARGE_STATUS.pendente;
    } else {
      status = CHARGE_STATUS.pendente;
    }

    const charge: Charge = {
      id: dedupeKey,
      billingAccountId: account.id,
      stationId: account.stationId,
      kind: CHARGE_KIND.energia,
      competencia,
      competenciaSource: competencia
        ? COMPETENCIA_SOURCE.inferredDueDate
        : COMPETENCIA_SOURCE.unknown,
      amount,
      expectedAmount: null,
      dueDate,
      status,
      matchStatus:
        account.stationId !== null
          ? MATCH_STATUS.autoMatched
          : MATCH_STATUS.unmatched,
      paymentMethod:
        autoDebit.status === AUTO_DEBIT_STATUS.cadastrado
          ? PAYMENT_METHOD.debitoAutomatico
          : null,
      banco: null,
      agencia: null,
      conta: null,
      chavePix: null,
      linhaDigitavel: null,
      notaFiscal: cleanCell(row["NF"] ?? "") || null,
      documentoNumero: null,
      issuerCnpj: null,
      source: isEnel ? INGEST_SOURCE.scraperEnel : INGEST_SOURCE.scraperEdp,
      dedupeKey,
      legacyRef: { tab, rowNumber: rowNo },
      notes: null,
      // Charge-level canonical fiscal flag (Q8): reuse the "Financeiro Check"
      // value already parsed above. Means "enviado ao fiscal", never "pago".
      fiscalExported,
      // Sheet-built charges have no bound source document (set only by the
      // Supabase writers: create_manual_bill / webhook / set_charge_document).
      sourceDocumentId: null,
      raw: stripRowKey(row),
    };
    charges.push(charge);

    energyDetails.push({
      chargeId: charge.id,
      nf: charge.notaFiscal,
      tariffC1: isEnel ? cleanCell(row["C1"] ?? "") || null : null,
      tariffC2: isEnel ? cleanCell(row["C2"] ?? "") || null : null,
      tariffC3: isEnel ? cleanCell(row["C3"] ?? "") || null : null,
      tariffC4: isEnel ? cleanCell(row["C4"] ?? "") || null : null,
      tariffC5: isEnel ? cleanCell(row["C5"] ?? "") || null : null,
      tariffC6: isEnel ? cleanCell(row["C6"] ?? "") || null : null,
      classificacao: !isEnel ? cleanCell(row["classificacao"] ?? "") || null : null,
      modalidade: !isEnel ? cleanCell(row["modalidade"] ?? "") || null : null,
      tipoFornecimento: !isEnel
        ? cleanCell(row["tipo_fornecimento"] ?? "") || null
        : null,
      tusdKwh: parseDecimal(row["TUSD (kWh)"] ?? ""),
      tusdAmount: parseDecimal(row["TUSD (R$)"] ?? ""),
      teKwh: parseDecimal(row["TE (kWh)"] ?? ""),
      teAmount: parseDecimal(row["TE (R$)"] ?? ""),
      cip: parseDecimal(row["CIP"] ?? ""),
      subFaturamento: isEnel ? parseDecimal(row["Sub_Faturamento"] ?? "") : null,
      total: parseDecimal(row["Total"] ?? ""),
      leituraAnterior: parseDateISO(row["Leitura Anterior"] ?? ""),
      leituraAtual: parseDateISO(row["Leitura Atual"] ?? ""),
      autoDebit: autoDebit.status,
      autoDebitRegistration: cleanCell(row["auto_debit_registration"] ?? "") || null,
      faturaDriveUrl: extractHyperlinkUrl(row["link_fatura"] ?? ""),
      fiscalExported,
      fiscalExportedAt: null,
    });
  }

  // Current per-installation state, keyed by account id — feeds the charge
  // status derivation above (built here so `states` is fully populated).
  const stateByAccountId = new Map(states.map((s) => [s.billingAccountId, s]));

  raw["Faturas_ENEL"].forEach((row, i) =>
    pushUtilityCharge("Faturas_ENEL", row, sheetRowNumber(row, i)),
  );
  raw["Faturas_EDP"].forEach((row, i) =>
    pushUtilityCharge("Faturas_EDP", row, sheetRowNumber(row, i)),
  );

  // ── Charges: 2_Pagamentos (rent + third-party energy evidence) ───────────
  const pagKeyCounts = new Map<string, number>();
  raw["2_Pagamentos"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const cadastroIdResult = parseStationId(row["cadastro_id"] ?? "");
    if (cadastroIdResult.error) {
      issues.add(
        "2_Pagamentos", rowNo, "cadastro_id", "invalid_cadastro_id",
        cadastroIdResult.error.replace("swap_station_id", "cadastro_id"),
        row["cadastro_id"] ?? null,
      );
    }
    const cadastroId = cadastroIdResult.stationId;
    const stationResult = parseStationId(row["swap_station_id"] ?? "");
    if (stationResult.error) {
      issues.add(
        "2_Pagamentos", rowNo, "swap_station_id", "invalid_station_id",
        stationResult.error, row["swap_station_id"] ?? null,
      );
    }

    const kindRaw = deaccent(cleanCell(row["Tipo de Cobrança"] ?? "").toLowerCase());
    let kind = CHARGE_KIND_MAP[kindRaw];
    if (kind === undefined) {
      issues.add(
        "2_Pagamentos", rowNo, "Tipo de Cobrança", "unknown_enum_literal",
        `unknown Tipo de Cobrança '${row["Tipo de Cobrança"]}' → aluguel`,
        row["Tipo de Cobrança"],
      );
      kind = CHARGE_KIND.aluguel;
    }

    const competencia = parseCompetenciaFromMesAno(
      row["Mês"] ?? "",
      row["Ano"] ?? "",
    );
    if (competencia === null) {
      issues.add(
        "2_Pagamentos", rowNo, "Mês", "unparseable_competencia",
        `unparseable Mês/Ano '${row["Mês"]}'/'${row["Ano"]}'`,
        `${row["Mês"]}/${row["Ano"]}`,
      );
    }

    const pago = parseBoolean(row["Pago"] ?? "") ?? false;
    const valor = parseValorCell(row["Valor"] ?? "");
    if (valor.kind === "unparseable" || valor.kind === "empty") {
      issues.add(
        "2_Pagamentos", rowNo, "Valor", "unparseable_money",
        valor.kind === "empty"
          ? "empty Valor cell — charge kept with amount null, needs_review"
          : `unparseable Valor '${valor.raw}' — raw kept in notes, needs_review`,
        valor.raw,
      );
    }
    for (const label of valor.unknownLabels) {
      issues.add(
        "2_Pagamentos", rowNo, "Valor", "invalid_value",
        `unknown Valor label '${label}' in '${valor.raw}'`, valor.raw,
      );
    }

    // normalizeCnpjCpf (not raw digitsOnly) so the third_party account key
    // matches the counterparty id upsertCounterparty derives — leading-zero
    // variants of one CNPJ map to ONE account.
    const cnpj = normalizeCnpjCpf(row["CNPJ"] ?? "");
    const parceiro = cleanCell(row["Parceiro"] ?? "");
    const isEnergyBearing =
      kind === CHARGE_KIND.energia || kind === CHARGE_KIND.aluguelEnergia;

    // Account attribution: pure rent rows → the contract's rent account;
    // energy-bearing rows → a third_party account (Hubees/DIA/Kitchen/...).
    let billingAccountId: string | null = null;
    let stationId: number | null = stationResult.stationId;
    if (isEnergyBearing) {
      const cpId = upsertCounterparty(
        /^unidentified$/i.test(parceiro) ? "" : parceiro,
        row["CNPJ"] ?? "",
        COUNTERPARTY_KIND.outro,
      );
      if (cpId !== null) {
        const cpKey = cnpj ?? `name:${slug(parceiro)}`;
        const accountId = `3p:${cpKey}:${stationId ?? "unmatched"}`;
        if (!accounts.has(accountId)) {
          accounts.set(accountId, {
            id: accountId,
            stationId,
            accountType: ACCOUNT_TYPE.thirdParty,
            enelId: null,
            edpUc: null,
            edpContractId: null,
            contractId: null,
            counterpartyId: cpId,
            externalRef: null,
            autoDebitRegistration: null,
            matchStatus:
              stationId !== null
                ? MATCH_STATUS.manuallyMatched
                : MATCH_STATUS.unmatched,
            isActive: true,
            notes: null,
          });
        }
        billingAccountId = accountId;
      }
    } else if (cadastroId !== null && accounts.has(`rent:${cadastroId}`)) {
      billingAccountId = `rent:${cadastroId}`;
      if (stationId === null) {
        stationId = accounts.get(`rent:${cadastroId}`)?.stationId ?? null;
      }
    } else if (cadastroId !== null) {
      issues.add(
        "2_Pagamentos", rowNo, "cadastro_id", "missing_account",
        `cadastro_id ${cadastroId} has no 1_Cadastro row — charge left unmatched`,
        String(cadastroId),
      );
    }

    const baseKey = pagamentosChargeDedupeKey(cadastroId, competencia, kind);
    const count = (pagKeyCounts.get(baseKey) ?? 0) + 1;
    pagKeyCounts.set(baseKey, count);
    const dedupeKey = count === 1 ? baseKey : `${baseKey}#${count}`;
    if (count > 1) {
      issues.add(
        "2_Pagamentos", rowNo, null, "duplicate_dedupe_key",
        `dedupe key collision for ${baseKey} — suffixed #${count} (row kept)`,
        baseKey,
      );
    }

    const payRaw = deaccent(cleanCell(row["Tipo de Pagamento"] ?? "").toLowerCase());
    const paymentMethod: PaymentMethod | null =
      PAYMENT_METHOD_MAP[payRaw] ?? (payRaw !== "" ? PAYMENT_METHOD.outro : null);

    const needsReview =
      valor.kind === "unparseable" ||
      valor.kind === "empty" ||
      (valor.kind === "labeled" && valor.amount === null);
    const matchStatus = needsReview
      ? MATCH_STATUS.needsReview
      : billingAccountId === null
        ? MATCH_STATUS.unmatched
        : MATCH_STATUS.manuallyMatched;

    const charge: Charge = {
      id: dedupeKey,
      billingAccountId,
      stationId,
      kind,
      competencia,
      competenciaSource: competencia
        ? COMPETENCIA_SOURCE.explicit
        : COMPETENCIA_SOURCE.unknown,
      amount: valor.amount,
      expectedAmount: valor.expectedAmount,
      dueDate: null,
      status: pago ? CHARGE_STATUS.pago : CHARGE_STATUS.pendente,
      matchStatus,
      paymentMethod,
      banco: cleanCell(row["Banco"] ?? "") || null,
      agencia: cleanCell(row["Agência"] ?? "") || null,
      conta: cleanCell(row["Conta Corrente"] ?? "") || null,
      chavePix: cleanCell(row["Chave Pix / Código do Boleto"] ?? "") || null,
      linhaDigitavel: null,
      notaFiscal: null,
      documentoNumero: null,
      issuerCnpj: cnpj,
      source: INGEST_SOURCE.sheetBackfill,
      dedupeKey,
      legacyRef: { tab: "2_Pagamentos", rowNumber: rowNo },
      notes:
        valor.kind === "labeled" || valor.kind === "unparseable"
          ? `Valor original: ${valor.raw}`
          : null,
      // Charge-level canonical fiscal flag (Q8): 2_Pagamentos "No Fiscal"
      // column (col R) — a TRUE/FALSE boolean like energy's "Financeiro Check"
      // (blank ⇒ not sent). Means "enviado ao fiscal", never "pago".
      fiscalExported: parseBoolean(row["No Fiscal"] ?? "") ?? false,
      // Sheet-built charges have no bound source document (Supabase-only).
      sourceDocumentId: null,
      raw: stripRowKey(row),
    };
    charges.push(charge);

    if (valor.energyAmount !== null) {
      chargeLines.push({
        id: `${dedupeKey}:energia`,
        chargeId: charge.id,
        lineKind: CHARGE_LINE_KIND.energia,
        description: "Energia (Valor reconciliado)",
        amount: valor.energyAmount,
        competencia,
        competenciaSource: competencia ? COMPETENCIA_SOURCE.explicit : null,
      });
    }
    if (valor.rentAmount !== null) {
      chargeLines.push({
        id: `${dedupeKey}:aluguel`,
        chargeId: charge.id,
        lineKind: CHARGE_LINE_KIND.aluguel,
        description: "Locação (Valor reconciliado)",
        amount: valor.rentAmount,
        competencia,
        competenciaSource: competencia ? COMPETENCIA_SOURCE.explicit : null,
      });
    }
  });

  // ── Rent adjustments (3_Reajustes) ───────────────────────────────────────
  raw["3_Reajustes"].forEach((row, i) => {
    const rowNo = sheetRowNumber(row, i);
    const stationResult = parseStationId(row["swap_station_id"] ?? "");
    if (stationResult.error) {
      issues.add(
        "3_Reajustes", rowNo, "swap_station_id", "invalid_station_id",
        stationResult.error, row["swap_station_id"] ?? null,
      );
    }
    const indexRaw = deaccent(cleanCell(row["Índice"] ?? "").toLowerCase());
    const indexType = ADJUSTMENT_INDEX_MAP[indexRaw] ?? ADJUSTMENT_INDEX.outro;
    const statusRaw = deaccent(cleanCell(row["Status"] ?? "").toLowerCase());
    let status = ADJUSTMENT_STATUS_MAP[statusRaw];
    if (status === undefined) {
      if (statusRaw !== "") {
        issues.add(
          "3_Reajustes", rowNo, "Status", "unknown_enum_literal",
          `unknown adjustment status '${row["Status"]}' → pendente`,
          row["Status"],
        );
      }
      status = ADJUSTMENT_STATUS.pendente;
    }
    const stationContracts =
      stationResult.stationId !== null
        ? (contractsByStation.get(stationResult.stationId) ?? [])
        : [];
    adjustments.push({
      id: `reajuste:${rowNo}`,
      contractId: stationContracts.length === 1 ? stationContracts[0].id : null,
      stationId: stationResult.stationId,
      negotiatedOn: parseDateISO(row["Data"] ?? ""),
      indexType,
      indexPct: parseDecimal(row["Índice (%)"] ?? ""),
      oldAmount: parseMoney(row["Valor Antigo (R$)"] ?? ""),
      newAmount: parseMoney(row["Valor Novo (R$)"] ?? ""),
      effectiveFrom: parseDateISO(row["Vigência a partir de"] ?? ""),
      status,
      notes: cleanCell(row["Observação"] ?? "") || null,
      raw: stripRowKey(row),
    });
  });

  // Referential note: accounts pointing at stations missing from Vammo_data
  // (rowNumber 0 = snapshot-level issue, not tied to a single sheet row).
  for (const account of accounts.values()) {
    if (account.stationId !== null && !stationIds.has(account.stationId)) {
      issues.add(
        "Vammo_data", 0, "swap_station_id", "missing_account",
        `account ${account.id} references station ${account.stationId} not present in Vammo_data`,
        String(account.stationId),
      );
    }
  }

  return {
    stations,
    counterparties: Array.from(counterparties.values()),
    contracts,
    billingAccounts: Array.from(accounts.values()),
    utilityAccountStates: states,
    monthlyConsumption: consumption,
    charges,
    chargeLines,
    chargeEnergyDetails: energyDetails,
    rentAdjustments: adjustments,
    issues: issues.issues,
  };
}
