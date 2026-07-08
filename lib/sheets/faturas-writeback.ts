import "server-only";

/**
 * Faturas writeback — appends manual-bill rows to the scraper spreadsheet's
 * `Faturas_ENEL` / `Faturas_EDP` tabs and drains the `charging.sheet_writebacks`
 * outbox (decision #19, D5). The DB is the source of truth; the sheet append is
 * best-effort with retries so the parallel n8n/Apps-Script ecosystem keeps
 * receiving rows during the transition.
 *
 * HARD RULE (decision #19 / M1): the app may ONLY append to the three tabs in
 * `ALLOWED_WRITEBACK_TABS` — asserted in code below; every other tab is refused.
 * Column manifests mirror Vammo-Enel/enel_helpers.py:36-42 + edp_helpers.py:27-33.
 */

import type { sheets_v4 } from "googleapis";

import type { ChargingClient } from "@/lib/data/supabase-repository";
import { getSheetsRwClient } from "@/lib/google/clients";

/** Allowlist asserted before any write (decision #19). */
export const ALLOWED_WRITEBACK_TABS = [
  "Faturas_ENEL",
  "Faturas_EDP",
  "2_Pagamentos",
] as const;
export type WritebackTab = (typeof ALLOWED_WRITEBACK_TABS)[number];

/** enel_helpers.py FATURAS_HEADERS (order preserved). */
export const FATURAS_ENEL_HEADERS = [
  "enel_id", "value", "due_date", "auto_debit", "auto_debit_registration",
  "NF", "link_fatura", "Financeiro Check", "Comprovante",
  "C1", "C2", "C3", "C4", "C5", "C6",
  "TUSD (kWh)", "TUSD (R$)", "TE (kWh)", "TE (R$)",
  "CIP", "Sub_Faturamento", "Total", "Leitura Anterior", "Leitura Atual",
] as const;

/** edp_helpers.py FATURAS_EDP_HEADERS (order preserved). */
export const FATURAS_EDP_HEADERS = [
  "uc", "value", "due_date", "auto_debit", "auto_debit_registration",
  "NF", "link_fatura", "Financeiro Check", "Comprovante",
  "classificacao", "modalidade", "tipo_fornecimento",
  "TUSD (kWh)", "TUSD (R$)", "TE (kWh)", "TE (R$)",
  "CIP", "Total", "Leitura Anterior", "Leitura Atual",
] as const;

/** The payload persisted in `sheet_writebacks.payload`. */
export interface SheetWritebackPayload {
  /** header name → cell value (already pt-BR formatted; `=HYPERLINK(...)` included). */
  headerValues: Record<string, string>;
  /** Optional `(id, due_date)` dup-check before appending (scraper parity). */
  dedupe?: { idHeader: string; idValue: string; dueHeader: string; dueValue: string };
}

export type AppendResult =
  | { appended: true }
  | { appended: false; skipped: "duplicate" };

function assertAllowedTab(tab: string): asserts tab is WritebackTab {
  if (!ALLOWED_WRITEBACK_TABS.includes(tab as WritebackTab)) {
    throw new Error(`writeback refused: tab '${tab}' is not in the allowlist`);
  }
}

function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/** `1042.29 → '1.042,29'` (mirror enel_helpers.py `_float_to_br`). */
export function floatToBr(x: number, decimals = 2): string {
  const fixed = x.toFixed(decimals);
  const [intPart, dec] = fixed.split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec !== undefined ? `${withThousands},${dec}` : withThousands;
}

/** `=HYPERLINK("<url>";"Ver Fatura")` (exact enel_helpers.py:372 shape). */
export function hyperlinkCell(url: string, label = "Ver Fatura"): string {
  if (!url) return "";
  return `=HYPERLINK("${url}";"${label}")`;
}

/**
 * Builds the `{ tab, payload }` for a manual energy bill row. `Financeiro Check`
 * is FALSE (never "paid" — decision #21); the link is a `=HYPERLINK` so the
 * sheet's viewers open the Drive PDF without a grant.
 */
export function buildManualBillWriteback(
  provider: "enel" | "edp",
  input: {
    externalId: string;
    valueNumber: number;
    dueDateIso: string;
    nf?: string | null;
    webViewLink?: string | null;
    autoDebit?: string | null;
    autoDebitRegistration?: string | null;
  },
): { tab: WritebackTab; payload: SheetWritebackPayload } {
  const idHeader = provider === "enel" ? "enel_id" : "uc";
  const tab: WritebackTab = provider === "enel" ? "Faturas_ENEL" : "Faturas_EDP";
  const headerValues: Record<string, string> = {
    [idHeader]: input.externalId,
    value: floatToBr(input.valueNumber),
    due_date: input.dueDateIso,
    auto_debit: input.autoDebit ?? "",
    auto_debit_registration: input.autoDebitRegistration ?? "",
    NF: input.nf ?? "",
    link_fatura: hyperlinkCell(input.webViewLink ?? ""),
    "Financeiro Check": "FALSE",
  };
  return {
    tab,
    payload: {
      headerValues,
      dedupe: {
        idHeader,
        idValue: input.externalId,
        dueHeader: "due_date",
        dueValue: input.dueDateIso,
      },
    },
  };
}

async function readGrid(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: quoteTab(tab),
    valueRenderOption: "FORMATTED_VALUE",
  });
  return (res.data.values ?? []).map((row) => row.map((c) => String(c ?? "")));
}

/**
 * Appends one row (mapped by header name) to a Faturas tab. Skips when the
 * `(id, due_date)` dup-check hits an existing row (scraper-style idempotency).
 */
export async function appendManualBillRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
  payload: SheetWritebackPayload,
): Promise<AppendResult> {
  assertAllowedTab(tab);
  const grid = await readGrid(sheets, spreadsheetId, tab);
  const headers = grid[0] ?? [];
  if (headers.length === 0) {
    throw new Error(`writeback: tab '${tab}' has no header row`);
  }

  if (payload.dedupe) {
    const { idHeader, idValue, dueHeader, dueValue } = payload.dedupe;
    const idCol = headers.indexOf(idHeader);
    const dueCol = headers.indexOf(dueHeader);
    if (idCol >= 0 && dueCol >= 0) {
      const dup = grid.slice(1).some(
        (r) =>
          (r[idCol] ?? "").trim() === idValue.trim() &&
          (r[dueCol] ?? "").trim() === dueValue.trim(),
      );
      if (dup) return { appended: false, skipped: "duplicate" };
    }
  }

  const row = headers.map((h) => payload.headerValues[h] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: quoteTab(tab),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return { appended: true };
}

interface WritebackRow {
  id: string;
  charge_id: string | null;
  tab: string | null;
  payload: SheetWritebackPayload | null;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

export interface OutboxResult {
  processed: number;
  completed: number;
  skipped: number;
  failed: number;
  pending: number;
}

/**
 * Drains pending `sheet_writebacks` (≤5 attempts). On the 5th failure the row
 * is marked `failed` and a `manual_bill_sheet_append_failed` alert is raised.
 * Backoff is enforced by the poller cadence (the outbox runs every poll pass).
 */
export async function processWritebackOutbox(
  admin: ChargingClient,
  limit = 25,
): Promise<OutboxResult> {
  const spreadsheetId = process.env.SCRAPER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SCRAPER_SPREADSHEET_ID not configured");
  const sheets = getSheetsRwClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("sheet_writebacks")
    .select("id, charge_id, tab, payload, attempts")
    .is("completed_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`sheet_writebacks read failed: ${error.message}`);

  const rows = (data ?? []) as WritebackRow[];
  const result: OutboxResult = {
    processed: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
  };

  for (const row of rows) {
    result.processed += 1;
    try {
      if (!row.tab || !row.payload) throw new Error("writeback row missing tab/payload");
      assertAllowedTab(row.tab);
      const res = await appendManualBillRow(sheets, spreadsheetId, row.tab, row.payload);
      await admin
        .from("sheet_writebacks")
        .update({
          status: "completed",
          completed_at: nowIso,
          last_error: res.appended ? null : "linha já existia — pulada",
        })
        .eq("id", row.id);
      if (res.appended) result.completed += 1;
      else result.skipped += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await admin
        .from("sheet_writebacks")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          last_error: message,
        })
        .eq("id", row.id);
      if (exhausted) {
        result.failed += 1;
        await admin.from("alerts").upsert(
          {
            alert_type: "manual_bill_sheet_append_failed",
            severity: "warning",
            charge_id: row.charge_id,
            dedupe_key: `manual_bill_sheet_append_failed:${row.id}`,
            payload: { tab: row.tab, error: message },
            last_detected_at: nowIso,
          },
          { onConflict: "dedupe_key" },
        );
      } else {
        result.pending += 1;
      }
    }
  }
  return result;
}
