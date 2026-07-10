import "server-only";

/**
 * Send energy faturas to the FISCAL spreadsheet (decision #42) — the WRITE half
 * of the fiscal flow, and the ONE place the app writes a Google Sheet (a scoped
 * exception to the decision #25 sever; the scraper/rent sheets stay severed).
 * The pure row construction + self-verification live in fiscal-row.ts (unit
 * tested); this module is the server orchestration (read → classify → append).
 *
 * Rule (Gabriel 2026-07-10): for each energy fatura NOT already on the sheet —
 *   due-year ≤ 2025 → ignore; due-year = 2026 → send IFF auto-debit=Cadastrado;
 *   due-year ≥ 2027 → BLOCK ("2027 BLOQUEADO - REVER FUNÇÃO", never written).
 * A locale guard refuses to write unless the sheet is pt-BR (the format assumes
 * it). Sent faturas are marked fiscal_exported=true by the caller (→ Ciclo 3).
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import type { createSheetsWriteClient } from "@/lib/ingest/sheets-loader";
import { checkFaturasOnFiscal } from "./check-faturas";
import { buildFiscalRow, nowFiscalTimestamp, selfVerifyRow, SENDABLE_YEAR } from "./fiscal-row";

type SheetsClient = ReturnType<typeof createSheetsWriteClient>;

export interface SendFiscalSummary {
  /** Rows successfully appended to the sheet. */
  sent: number;
  /** charge ids of the sent faturas (caller marks fiscal_exported=true). */
  sentChargeIds: string[];
  /** Skipped: already had the "Enviado ao fiscal" check (fiscal_exported=true). */
  alreadyChecked: number;
  /** Was unchecked but already on the sheet → caller marks fiscal_exported=true. */
  alreadyOnSheet: number;
  alreadyOnSheetChargeIds: string[];
  /** Skipped: due-year ≤ SENDABLE_YEAR-1. */
  ignoredPast: number;
  /** Skipped: due-year ≥ SENDABLE_YEAR+1 (guardrail). */
  blockedFuture: number;
  /** Skipped: not Cadastrado (não/desconhecido). */
  naoCadastrado: number;
  /** Skipped: 2026 fatura whose due-month tab does not exist yet. */
  semAba: number;
  /** Skipped: no valor. */
  noValor: number;
  /** Skipped: the built row failed the round-trip self-check (never appended). */
  verifyFailed: number;
  /** Rows whose per-tab append call errored (NOT sent). */
  appendFailed: number;
  /** Set when any future-dated fatura was blocked. */
  blockedWarning: string | null;
}

function emptySummary(): SendFiscalSummary {
  return {
    sent: 0,
    sentChargeIds: [],
    alreadyChecked: 0,
    alreadyOnSheet: 0,
    alreadyOnSheetChargeIds: [],
    ignoredPast: 0,
    blockedFuture: 0,
    naoCadastrado: 0,
    semAba: 0,
    noValor: 0,
    verifyFailed: 0,
    appendFailed: 0,
    blockedWarning: null,
  };
}

/**
 * Checks every energy fatura against the FISCAL sheet and appends the eligible,
 * not-yet-registered ones (Cadastrado, due-year SENDABLE_YEAR) to their
 * due-month tab. `sheets` must be a READ-WRITE client whose SA has Editor.
 */
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

  const { results } = await checkFaturasOnFiscal(admin, sheets, spreadsheetId);

  const summary = emptySummary();
  const byTab = new Map<string, { row: string[]; chargeId: string }[]>();

  for (const f of results) {
    // Gabriel: only run for faturas WITHOUT the check. Ones already marked
    // "Enviado ao fiscal" are done — skip them (no re-validate, no re-send).
    if (f.fiscalExported) {
      summary.alreadyChecked += 1;
      continue;
    }
    // Unchecked but already on the sheet → don't re-send; the caller marks it
    // checked so it leaves the queue.
    if (f.registered) {
      summary.alreadyOnSheet += 1;
      summary.alreadyOnSheetChargeIds.push(f.chargeId);
      continue;
    }
    const year = Number(f.dueDate.slice(0, 4));
    if (!Number.isFinite(year) || year <= SENDABLE_YEAR - 1) {
      summary.ignoredPast += 1;
      continue;
    }
    if (year >= SENDABLE_YEAR + 1) {
      summary.blockedFuture += 1;
      continue;
    }
    // due-year === SENDABLE_YEAR
    if (f.autoDebit !== "cadastrado") {
      summary.naoCadastrado += 1;
      continue;
    }
    if (!f.tabExists) {
      summary.semAba += 1;
      continue;
    }
    if (f.amount === null) {
      summary.noValor += 1;
      continue;
    }
    const row = buildFiscalRow(f, timestamp, sep);
    if (!selfVerifyRow(row, f)) {
      summary.verifyFailed += 1;
      continue;
    }
    const list = byTab.get(f.tab);
    if (list) list.push({ row, chargeId: f.chargeId });
    else byTab.set(f.tab, [{ row, chargeId: f.chargeId }]);
  }

  if (summary.blockedFuture > 0) {
    summary.blockedWarning = "2027 BLOQUEADO - REVER FUNÇÃO";
  }

  // Append per tab (one call per tab). A per-tab failure is isolated: its rows
  // are not counted as sent, the rest still go.
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
      for (const i of items) summary.sentChargeIds.push(i.chargeId);
    } catch {
      summary.appendFailed += items.length;
    }
  }

  return summary;
}
