/**
 * FISCAL spreadsheet check — "is this fatura already registered on the fiscal
 * sheet?" (pre-requisite of the send-to-fiscal flow; Q8/Q12).
 *
 * The FISCAL sheet is NOT the scraper sheet — decision #25's sever doesn't
 * cover it (Q12). It is written by the fiscal upload automations; this module
 * only READS it, with the same read-only service account used for the final
 * clone (`GSHEETS_SA_KEY_B64` — grant it Viewer on the fiscal spreadsheet).
 *
 * Layout (one tab per DUE-DATE month, named 'MM-YYYY', e.g. '03-2026'; no
 * header row observed). Columns, 0-based:
 *
 *   0  upload timestamp 'DD/MM/YYYY HH:mm:ss'
 *   1  'DA' when the installation pays via débito automático (else blank)
 *   2  supplier razão social (Eletropaulo… / EDP São Paulo…)
 *   3  valor, pt-BR decimals ('40,24')
 *   4  nota fiscal number ('77815259')
 *   5  'Consumo de energia - {enel_id|edp_uc}[ DA]'
 *   6  due date 'DD/MM/YYYY'
 *   7  category ('401: Charging Infra/Energy: Electricity')
 *   8  account ('COGS - 401: …')
 *   9  (empty)
 *   10 status text ('Upload de Fatura - Aguardando atualização FISCAL', …)
 *   11 'Ver Fatura' (=HYPERLINK to the bill PDF)
 *
 * Parsing reuses lib/ingest/normalize.ts (the only pt-BR parsing home) and is
 * defensive about column drift: the installation id is found by scanning every
 * cell for the 'Consumo de energia - {id}' pattern, not by fixed index.
 */

import {
  cleanCell,
  parseDateISO,
  parseMoney,
  parseTimestamp,
} from "@/lib/ingest/normalize";
import { createSheetsClient } from "@/lib/ingest/sheets-loader";

// ─── Pure helpers (unit-tested; no I/O) ──────────────────────────────────────

/** 'Consumo de energia - 204913042' / '… - 151405175 DA' → the id digits. */
const INSTALLATION_ID_RE = /consumo\s+de\s+energia\s*[-–]\s*(\d+)/i;

/** ISO 'YYYY-MM-DD' due date → the fiscal tab name 'MM-YYYY'. */
export function fiscalTabForDueDate(dueDateIso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dueDateIso.trim());
  if (!m) throw new Error(`Invalid ISO due date: ${dueDateIso}`);
  return `${m[2]}-${m[1]}`;
}

/** One parsed row of a fiscal tab (nulls where a cell is absent/unparseable). */
export interface FiscalRow {
  /** 1-based row number within the tab (for human reference). */
  rowNumber: number;
  /** ISO 'YYYY-MM-DDTHH:mm:ss' upload timestamp. */
  uploadedAt: string | null;
  autoDebit: boolean;
  supplier: string | null;
  valor: number | null;
  notaFiscal: string | null;
  /** enel_id / edp_uc extracted from the description cell. */
  installationId: string | null;
  /** ISO 'YYYY-MM-DD'. */
  dueDate: string | null;
  status: string | null;
}

/** Parses one raw row; returns null for rows with no fatura signal at all. */
export function parseFiscalRow(
  cells: string[],
  rowNumber: number,
): FiscalRow | null {
  const cell = (i: number) => cleanCell(cells[i] ?? "");

  // Installation id: prefer the description column, fall back to any cell.
  let installationId: string | null = null;
  const descMatch = INSTALLATION_ID_RE.exec(cell(5));
  if (descMatch) {
    installationId = descMatch[1];
  } else {
    for (const raw of cells) {
      const m = INSTALLATION_ID_RE.exec(cleanCell(raw));
      if (m) {
        installationId = m[1];
        break;
      }
    }
  }

  const notaFiscal = /^\d+$/.test(cell(4)) ? cell(4) : null;
  const dueDate = parseDateISO(cell(6));
  if (installationId === null && notaFiscal === null && dueDate === null) {
    return null; // blank / separator row
  }

  return {
    rowNumber,
    uploadedAt: parseTimestamp(cell(0)),
    autoDebit: cell(1).toUpperCase() === "DA",
    supplier: cell(2) || null,
    valor: parseMoney(cell(3)),
    notaFiscal,
    installationId,
    dueDate,
    status: cell(10) || null,
  };
}

export interface FiscalFaturaQuery {
  /** enel_id or edp_uc (digits, as stored on the billing account). */
  installationId: string;
  /** ISO 'YYYY-MM-DD' — picks the 'MM-YYYY' tab and disambiguates rows. */
  dueDate: string;
  /** Optional nota fiscal — an NF-only match also counts as registered. */
  notaFiscal?: string | null;
}

/**
 * Rows of one tab that match the query. A row matches when:
 *  - its installation id equals the query's AND its due date is absent or
 *    equal (the tab is already the due month, so same-id rows are the same
 *    fatura unless the due date says otherwise); OR
 *  - the query's nota fiscal equals the row's (survives description typos).
 */
export function findFaturaRows(
  grid: string[][],
  query: FiscalFaturaQuery,
): FiscalRow[] {
  const wantId = query.installationId.trim();
  const wantNf = query.notaFiscal?.trim() || null;
  const matches: FiscalRow[] = [];
  grid.forEach((cells, i) => {
    const row = parseFiscalRow(cells, i + 1);
    if (!row) return;
    const idMatch =
      row.installationId === wantId &&
      (row.dueDate === null || row.dueDate === query.dueDate);
    const nfMatch = wantNf !== null && row.notaFiscal === wantNf;
    if (idMatch || nfMatch) matches.push(row);
  });
  return matches;
}

// ─── Sheet read ──────────────────────────────────────────────────────────────

export interface FiscalCheckResult {
  /** True when at least one row on the due-month tab matches the fatura. */
  registered: boolean;
  /** Tab that was checked ('MM-YYYY' from the due date). */
  tab: string;
  /** False when the sheet has no tab for that month yet (nothing uploaded). */
  tabExists: boolean;
  matches: FiscalRow[];
}

/** Missing-tab errors from values.get ("Unable to parse range: '13-2026'"). */
function isMissingTabError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unable to parse range/i.test(msg);
}

/**
 * Checks whether a fatura is already registered on the FISCAL spreadsheet.
 * Reads only the tab of the fatura's due month. Throws when the env vars
 * (`FISCAL_SPREADSHEET_ID`, `GSHEETS_SA_KEY_B64`) are missing or the read
 * fails for a reason other than a not-yet-created month tab.
 */
export async function checkFaturaOnFiscalSheet(
  query: FiscalFaturaQuery,
  env: Record<string, string | undefined> = process.env,
): Promise<FiscalCheckResult> {
  const spreadsheetId = env.FISCAL_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("FISCAL_SPREADSHEET_ID not configured");
  }
  const tab = fiscalTabForDueDate(query.dueDate);
  const sheets = createSheetsClient(env);

  let values: unknown[][] | null | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab}'`,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    values = res.data.values as unknown[][] | null | undefined;
  } catch (err) {
    if (isMissingTabError(err)) {
      return { registered: false, tab, tabExists: false, matches: [] };
    }
    throw err;
  }

  const grid = (values ?? []).map((row) =>
    row.map((c) => (c === null || c === undefined ? "" : String(c))),
  );
  const matches = findFaturaRows(grid, query);
  return { registered: matches.length > 0, tab, tabExists: true, matches };
}
