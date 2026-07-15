import "server-only";

/**
 * Send energy faturas to the FISCAL spreadsheet (decision #42) — the WRITE half
 * of the fiscal flow, and the ONE place the app writes a Google Sheet (a scoped
 * exception to the decision #25 sever; the scraper/rent sheets stay severed).
 * The pure row construction, the classifier, and the self-verification live in
 * fiscal-row.ts (unit tested); this module is the server orchestration
 * (read sheet → classify → append → return the DB-write id sets).
 *
 * Clicking "Enviar ao fiscal em lote" runs "Verificar no fiscal" first (Gabriel
 * 2026-07-10): a single sheet read drives BOTH the fiscal_exported sync (all on
 * the sheet → true, the rest → false) AND the append of the eligible ones.
 *
 * Rule: for a fatura NOT already on the sheet — amount 0 → paid + auto-checked,
 * not sent (decision #42 #29-exception); due date already passed → not sent;
 * due-year ≤ 2025 → ignore; = 2026 + Cadastrado → send; ≥ 2027 → BLOCK
 * ("2027 BLOQUEADO - REVER FUNÇÃO"). A pt-BR locale guard refuses to write
 * unless the sheet is pt-BR. The caller applies the id sets via audited RPCs.
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import type { createSheetsWriteClient } from "@/lib/ingest/sheets-loader";
import { checkFaturasOnFiscal } from "./check-faturas";
import {
  buildFiscalRow,
  classifyFaturaForSend,
  fiscalTodayISO,
  nowFiscalTimestamp,
  selfVerifyRow,
} from "./fiscal-row";

type SheetsClient = ReturnType<typeof createSheetsWriteClient>;

export interface SendFiscalSummary {
  /** Rows successfully appended to the sheet this run. */
  sent: number;
  /** Already on the sheet (registered) — verify marks them checked. */
  alreadyOnSheet: number;
  /** Value 0 → paid + auto-checked, not sent. */
  zeroValue: number;
  /** Skipped: due date already passed. */
  pastDue: number;
  /** Skipped: sem débito automático (manual queue). */
  naoCadastrado: number;
  /** Skipped: due-year ≤ SENDABLE_YEAR-1. */
  ignoredPast: number;
  /** Skipped: due-year ≥ SENDABLE_YEAR+1 (guardrail). */
  blockedFuture: number;
  /** Skipped: 2026 but the due-month tab does not exist. */
  semAba: number;
  /** Skipped: no valor (amount null). */
  noValor: number;
  /** Built rows that failed the round-trip self-check (never appended). */
  verifyFailed: number;
  /** Rows whose per-tab append call errored (NOT sent). */
  appendFailed: number;
  blockedWarning: string | null;

  // ── id sets the caller applies via RPCs (the "verify" sync + settle) ──
  /** → fiscal_exported=true (registered + sent). */
  fiscalTrueIds: string[];
  /** → fiscal_exported=false (not on sheet, non-zero, not sent) — the demote. */
  fiscalFalseIds: string[];
  /** → settle: paid + checked (value 0). */
  zeroValueIds: string[];
}

function emptySummary(): SendFiscalSummary {
  return {
    sent: 0,
    alreadyOnSheet: 0,
    zeroValue: 0,
    pastDue: 0,
    naoCadastrado: 0,
    ignoredPast: 0,
    blockedFuture: 0,
    semAba: 0,
    noValor: 0,
    verifyFailed: 0,
    appendFailed: 0,
    blockedWarning: null,
    fiscalTrueIds: [],
    fiscalFalseIds: [],
    zeroValueIds: [],
  };
}

export async function sendFaturasToFiscal(
  admin: ChargingClient,
  sheets: SheetsClient,
  spreadsheetId: string,
  now: Date,
): Promise<SendFiscalSummary> {
  // Locale guard — the whole row format (decimal comma, DD/MM/YYYY, ';' in
  // HYPERLINK) assumes pt-BR. Refuse to write if the sheet is anything else.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.locale",
  });
  const locale = (meta.data.properties?.locale ?? "").toLowerCase();
  if (!locale.startsWith("pt")) {
    throw new Error(
      `planilha fiscal não está em pt-BR (locale=${locale || "?"}) — envio bloqueado, rever formato`,
    );
  }
  const sep = ";" as const;
  const timestamp = nowFiscalTimestamp(now);
  const todayIso = fiscalTodayISO(now);

  // "Verificar no fiscal" first: one read of the live sheet drives everything.
  const { results } = await checkFaturasOnFiscal(admin, sheets, spreadsheetId);

  const summary = emptySummary();
  const byTab = new Map<string, { row: string[]; chargeId: string }[]>();

  for (const f of results) {
    switch (classifyFaturaForSend(f, todayIso)) {
      case "registered":
        summary.alreadyOnSheet += 1;
        summary.fiscalTrueIds.push(f.chargeId);
        break;
      case "zero":
        summary.zeroValue += 1;
        summary.zeroValueIds.push(f.chargeId);
        break;
      case "noValor":
        summary.noValor += 1;
        summary.fiscalFalseIds.push(f.chargeId);
        break;
      case "ignoredPast":
        summary.ignoredPast += 1;
        summary.fiscalFalseIds.push(f.chargeId);
        break;
      case "blockedFuture":
        summary.blockedFuture += 1;
        summary.fiscalFalseIds.push(f.chargeId);
        break;
      case "pastDue":
        summary.pastDue += 1;
        summary.fiscalFalseIds.push(f.chargeId);
        break;
      case "naoCadastrado":
        summary.naoCadastrado += 1;
        summary.fiscalFalseIds.push(f.chargeId);
        break;
      case "semAba":
        summary.semAba += 1;
        summary.fiscalFalseIds.push(f.chargeId);
        break;
      case "send": {
        const row = buildFiscalRow(f, timestamp, sep);
        if (!selfVerifyRow(row, f)) {
          summary.verifyFailed += 1;
          summary.fiscalFalseIds.push(f.chargeId);
          break;
        }
        const list = byTab.get(f.tab);
        if (list) list.push({ row, chargeId: f.chargeId });
        else byTab.set(f.tab, [{ row, chargeId: f.chargeId }]);
        break;
      }
    }
  }

  if (summary.blockedFuture > 0) {
    summary.blockedWarning = "2027 BLOQUEADO - REVER FUNÇÃO";
  }

  // Append per tab (one call each). A per-tab failure is isolated: those rows
  // are not counted as sent and are marked NOT on the sheet.
  for (const [tab, items] of byTab) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${tab}'`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: items.map((i) => i.row) },
      });
      summary.sent += items.length;
      for (const i of items) summary.fiscalTrueIds.push(i.chargeId);
    } catch {
      summary.appendFailed += items.length;
      for (const i of items) summary.fiscalFalseIds.push(i.chargeId);
    }
  }

  return summary;
}

/** Per-bill send outcome — the classifier cases + the terminal states. */
export type SendOneOutcome =
  | "sent"
  | "registered"
  | "zero"
  | "noValor"
  | "ignoredPast"
  | "blockedFuture"
  | "pastDue"
  | "naoCadastrado"
  | "semAba"
  | "verifyFailed"
  | "appendFailed"
  | "notFound";

export interface SendOneFaturaResult {
  outcome: SendOneOutcome;
  fiscalTrueIds: string[];
  fiscalFalseIds: string[];
  zeroValueIds: string[];
}

/**
 * Send ONE specific fatura to the FISCAL sheet (Gabriel 2026-07-14). Applies the
 * EXACT SAME rules as the batch (`classifyFaturaForSend`) — chosen over a manual
 * override so a single send can never write something the batch wouldn't. Same
 * locale guard, same self-verify round-trip. The caller applies the id sets via
 * the audited RPCs (identical to the batch).
 */
export async function sendOneFaturaToFiscal(
  admin: ChargingClient,
  sheets: SheetsClient,
  spreadsheetId: string,
  chargeId: string,
  now: Date,
): Promise<SendOneFaturaResult> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.locale",
  });
  const locale = (meta.data.properties?.locale ?? "").toLowerCase();
  if (!locale.startsWith("pt")) {
    throw new Error(
      `planilha fiscal não está em pt-BR (locale=${locale || "?"}) — envio bloqueado, rever formato`,
    );
  }
  const sep = ";" as const;
  const timestamp = nowFiscalTimestamp(now);
  const todayIso = fiscalTodayISO(now);

  const { results } = await checkFaturasOnFiscal(admin, sheets, spreadsheetId);
  const f = results.find((r) => r.chargeId === chargeId);
  const empty: SendOneFaturaResult = {
    outcome: "notFound",
    fiscalTrueIds: [],
    fiscalFalseIds: [],
    zeroValueIds: [],
  };
  if (!f) return empty;

  switch (classifyFaturaForSend(f, todayIso)) {
    case "registered":
      return { ...empty, outcome: "registered", fiscalTrueIds: [chargeId] };
    case "zero":
      return { ...empty, outcome: "zero", zeroValueIds: [chargeId] };
    case "noValor":
      return { ...empty, outcome: "noValor", fiscalFalseIds: [chargeId] };
    case "ignoredPast":
      return { ...empty, outcome: "ignoredPast", fiscalFalseIds: [chargeId] };
    case "blockedFuture":
      return { ...empty, outcome: "blockedFuture", fiscalFalseIds: [chargeId] };
    case "pastDue":
      return { ...empty, outcome: "pastDue", fiscalFalseIds: [chargeId] };
    case "naoCadastrado":
      return { ...empty, outcome: "naoCadastrado", fiscalFalseIds: [chargeId] };
    case "semAba":
      return { ...empty, outcome: "semAba", fiscalFalseIds: [chargeId] };
    case "send": {
      const row = buildFiscalRow(f, timestamp, sep);
      if (!selfVerifyRow(row, f)) {
        return { ...empty, outcome: "verifyFailed", fiscalFalseIds: [chargeId] };
      }
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${f.tab}'`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [row] },
        });
        return { ...empty, outcome: "sent", fiscalTrueIds: [chargeId] };
      } catch {
        return { ...empty, outcome: "appendFailed", fiscalFalseIds: [chargeId] };
      }
    }
  }
}
