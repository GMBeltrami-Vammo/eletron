/**
 * xlsx fixtures reader — dev fallback + test data source.
 *
 * Node-only (fs + SheetJS); used by vitest and by the repository when the
 * Sheets env vars are absent. Produces the exact same RawTabs shape as
 * sheets-loader so normalize.ts cannot tell the sources apart.
 *
 * Cell-rendering quirks handled here so both loaders agree:
 * - link_fatura cells on the Faturas tabs keep their stored formula and are
 *   emitted as '=HYPERLINK(...)' strings (what FORMULA render returns live);
 * - numeric cells the xlsx export renders in scientific notation
 *   ('2.80969E+11' edp_id / auto_debit_registration / CNPJ) are emitted as
 *   full-precision digit strings, matching what Sheets FORMATTED_VALUE shows;
 * - everything else uses the formatted text (cell.w), matching
 *   FORMATTED_VALUE.
 *
 * The 2_Pagamentos '#REF!' header repair lives in raw-tabs.ts (shared).
 */

import { readFileSync } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  FORMULA_TABS,
  gridToRows,
  RENT_TABS,
  SCRAPER_TABS,
  type RawRow,
  type RawTabs,
  type TabName,
} from "./raw-tabs";

export type { RawTabs, RawRow };

export const SCRAPER_FIXTURE_FILENAME = "SwapStation-Charging-Finance (1).xlsx";
export const RENT_FIXTURE_FILENAME = "Locacoes_Template.xlsx";

/** Full-precision decimal string for a JS number (never scientific). */
function fullPrecisionNumber(v: number): string {
  const s = String(v);
  if (!/e/i.test(s)) return s;
  // Beyond Number.MAX_SAFE_INTEGER precision is already lost in the file;
  // toFixed(0) at least keeps a plain digit string.
  return v.toFixed(0);
}

function cellToString(
  cell: XLSX.CellObject | undefined,
  formulaTab: boolean,
): string {
  if (!cell) return "";
  if (
    formulaTab &&
    typeof cell.f === "string" &&
    /hyperlink/i.test(cell.f)
  ) {
    return `=${cell.f}`;
  }
  const formatted = typeof cell.w === "string" ? cell.w : undefined;
  if (
    cell.t === "n" &&
    typeof cell.v === "number" &&
    formatted !== undefined &&
    /\d[eE][+-]?\d/.test(formatted)
  ) {
    return fullPrecisionNumber(cell.v);
  }
  if (formatted !== undefined) return formatted;
  if (cell.v === undefined || cell.v === null) return "";
  return String(cell.v);
}

function sheetToGrid(ws: XLSX.WorkSheet, formulaTab: boolean): string[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const grid: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      row.push(cellToString(cell, formulaTab));
    }
    grid.push(row);
  }
  return grid;
}

function readWorkbook(filePath: string): XLSX.WorkBook {
  return XLSX.read(readFileSync(filePath), { type: "buffer", cellFormula: true });
}

function loadTabsFromWorkbook(
  wb: XLSX.WorkBook,
  tabs: readonly TabName[],
  filePath: string,
): Partial<RawTabs> {
  const out: Partial<RawTabs> = {};
  for (const tab of tabs) {
    const ws = wb.Sheets[tab];
    if (!ws) {
      throw new Error(`Fixture ${filePath} is missing tab '${tab}'`);
    }
    out[tab] = gridToRows(tab, sheetToGrid(ws, FORMULA_TABS.has(tab)));
  }
  return out;
}

/**
 * Loads all nine Phase 1 tabs from the two fixture files in `context/`.
 * `contextDir` defaults to `<cwd>/context` (vitest and `next dev` both run
 * from the repo root).
 */
export async function loadRawTabsFromFixtures(
  contextDir: string = path.join(process.cwd(), "context"),
): Promise<RawTabs> {
  const scraperPath = path.join(contextDir, SCRAPER_FIXTURE_FILENAME);
  const rentPath = path.join(contextDir, RENT_FIXTURE_FILENAME);
  const scraperWb = readWorkbook(scraperPath);
  const rentWb = readWorkbook(rentPath);
  return {
    ...loadTabsFromWorkbook(scraperWb, SCRAPER_TABS, scraperPath),
    ...loadTabsFromWorkbook(rentWb, RENT_TABS, rentPath),
  } as RawTabs;
}
