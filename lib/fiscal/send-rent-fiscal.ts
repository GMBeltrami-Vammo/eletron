import "server-only";

/**
 * DORMANT rent/boleto fiscal-send scaffold (decision #65). Gabriel 2026-07-17:
 * "when a boleto is approved to payment, ALSO send it to the fiscal sheet — one
 * entry per station, repeat the document when necessary. FOR NOW, DO NOT SEND;
 * leave the scaffold ready."
 *
 * So this module is fully built but GATED OFF by `RENT_FISCAL_SEND_ENABLED`:
 * while false it builds the rows (for preview/inspection) and returns WITHOUT
 * ever touching the sheet. Flip the flag to go live. The exact row format lives
 * in rent-fiscal-row.ts (unit-tested).
 *
 * ── To enable (the wiring left for later) ────────────────────────────────────
 * 1. Flip RENT_FISCAL_SEND_ENABLED = true.
 * 2. Data-prep: for each approved boleto charge build a RentFiscalRowInput —
 *    parceiro = counterparty razão social; valorTotal = charge.amount;
 *    notaFiscal = charge.nota_fiscal; competencia = charge.competencia;
 *    endereco = station.address; dueDate = charge.due_date (DD/MM/YYYY);
 *    documentUrl = the source document's Drive/web link; contractRentAmount =
 *    the station's ACTIVE contract valor_mensal (only for aluguel_energia).
 *    ONE input per station (a multi-station ND → N inputs, same document link).
 * 3. Trigger: call this from the approve-to-payment path (ApproveCobrancaDialog
 *    → reclassify), best-effort, after the charge is approved. Scope decision
 *    #65: energia pura also routes here — reconcile with the energy send (#42)
 *    so a fatura is never sent twice (e.g. skip energy already fiscal_exported).
 * 4. Guards to add before writing (mirror #42, "cannot be mistaken"): year
 *    guard (2026 only, ≥2027 block), past-due skip, and a read of the sheet to
 *    avoid duplicates. This dormant scaffold intentionally omits them.
 */

import type { createSheetsWriteClient } from "@/lib/ingest/sheets-loader";
import {
  buildRentFiscalRow,
  type RentFiscalRowInput,
} from "./rent-fiscal-row";

/** Master switch — MUST stay false until the send is validated end-to-end. */
export const RENT_FISCAL_SEND_ENABLED = false;

type SheetsClient = ReturnType<typeof createSheetsWriteClient>;

export interface RentFiscalSendSummary {
  /** Whether the send actually ran (false → dormant, nothing written). */
  enabled: boolean;
  /** Rows that WOULD be appended (built + grouped), for preview while dormant. */
  built: number;
  /** Rows actually appended (0 while dormant). */
  sent: number;
  /** The built rows, keyed by their due-month tab (for inspection/preview). */
  rowsByTab: Record<string, string[][]>;
}

/** 'DD/MM/YYYY' → 'MM-YYYY' (the fiscal month tab, mirroring the energy send). */
export function rentFiscalTab(dueDateBR: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dueDateBR);
  return m ? `${m[2]}-${m[3]}` : null;
}

/**
 * Builds the rent/boleto fiscal rows and — ONLY when RENT_FISCAL_SEND_ENABLED —
 * appends them to the FISCAL sheet, one row per station, grouped by due-month
 * tab. While disabled it returns the built rows without any sheet call, so the
 * caller can wire + inspect it safely. A pt-BR locale guard protects the format
 * before any write (same as the energy send, #42).
 */
export async function sendRentFiscalRows(
  sheets: SheetsClient,
  spreadsheetId: string,
  inputs: RentFiscalRowInput[],
): Promise<RentFiscalSendSummary> {
  const sep = ";" as const;
  const rowsByTab: Record<string, string[][]> = {};
  for (const input of inputs) {
    const tab = rentFiscalTab(input.dueDate);
    if (!tab) continue; // no valid due date → cannot place it in a month tab
    const row = buildRentFiscalRow(input, sep);
    (rowsByTab[tab] ??= []).push(row);
  }
  const built = Object.values(rowsByTab).reduce((n, r) => n + r.length, 0);

  // DORMANT: never touch the sheet while the flag is off.
  if (!RENT_FISCAL_SEND_ENABLED) {
    return { enabled: false, built, sent: 0, rowsByTab };
  }

  // ── live path (unreached while dormant) ──
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.locale",
  });
  const locale = (meta.data.properties?.locale ?? "").toLowerCase();
  if (!locale.startsWith("pt")) {
    throw new Error(
      `planilha fiscal não está em pt-BR (locale=${locale || "?"}) — envio bloqueado`,
    );
  }

  let sent = 0;
  for (const [tab, rows] of Object.entries(rowsByTab)) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tab}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
    sent += rows.length;
  }
  return { enabled: true, built, sent, rowsByTab };
}
