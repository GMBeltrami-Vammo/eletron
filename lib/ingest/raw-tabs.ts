/**
 * Shared contract between the two raw-data loaders (Google Sheets + xlsx
 * fixtures): both produce the same `RawTabs` shape — for each tab, an array of
 * header-name-keyed row objects with every cell as a plain string.
 *
 * Column resolution is strictly by header name (month columns are inserted
 * dynamically by the scraper); positional access is forbidden everywhere
 * except the one documented '#REF!' header repair below.
 *
 * This module is pure (no Node-only imports) so normalize.ts and tests can
 * share it.
 */

export type RawRow = Record<string, string>;

export const SCRAPER_TABS = [
  "Vammo_data",
  "enel_data",
  "edp_data",
  "Faturas_ENEL",
  "Faturas_EDP",
  "MatchingQualityCheck",
] as const;

export const RENT_TABS = ["1_Cadastro", "2_Pagamentos", "3_Reajustes"] as const;

export type ScraperTab = (typeof SCRAPER_TABS)[number];
export type RentTab = (typeof RENT_TABS)[number];
export type TabName = ScraperTab | RentTab;

export type RawTabs = Record<TabName, RawRow[]>;

/** Tabs whose link_fatura cells are =HYPERLINK formulas (FORMULA render). */
export const FORMULA_TABS: ReadonlySet<TabName> = new Set<TabName>([
  "Faturas_ENEL",
  "Faturas_EDP",
]);

/**
 * Loader-attached 1-based sheet row number (header = row 1). gridToRows skips
 * fully-empty scaffolding rows, so the original position must travel with the
 * row for issue provenance.
 */
export const SHEET_ROW_KEY = "__sheetRow";

/** Reads the loader-attached sheet row number back (fallback: index + 2). */
export function sheetRowNumber(row: RawRow, indexInTab: number): number {
  const v = row[SHEET_ROW_KEY];
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : indexInTab + 2;
}

/**
 * Repairs known header damage before keying rows.
 *
 * 2_Pagamentos: the boolean paid column's header formula broke into '#REF!'
 * in the source sheet. It is the only '#REF!' header on that tab (the intact
 * 'Teste' tab confirms the column is 'Pago'), so we remap that one broken
 * HEADER by position to 'Pago' — data cells are never accessed positionally.
 */
export function repairHeaders(tab: TabName, headers: string[]): string[] {
  const trimmed = headers.map((h) => h.trim());
  if (tab === "2_Pagamentos" && !trimmed.includes("Pago")) {
    const refIndexes = trimmed
      .map((h, i) => (h === "#REF!" ? i : -1))
      .filter((i) => i >= 0);
    if (refIndexes.length === 1) {
      trimmed[refIndexes[0]] = "Pago";
    }
  }
  return trimmed;
}

/**
 * Turns a raw string grid (first row = headers) into header-keyed row objects.
 *
 * - headers are trimmed and repaired (see repairHeaders);
 * - empty-string headers are skipped (their column is dropped);
 * - duplicate headers keep the FIRST occurrence (later columns dropped);
 * - fully-empty rows are skipped (Sheets scaffolding rows);
 * - every row carries its original sheet row number under SHEET_ROW_KEY.
 */
export function gridToRows(tab: TabName, grid: string[][]): RawRow[] {
  if (grid.length === 0) return [];
  const headers = repairHeaders(tab, grid[0]);
  const seen = new Set<string>();
  const columns: { header: string; index: number }[] = [];
  headers.forEach((header, index) => {
    if (header === "" || seen.has(header)) return;
    seen.add(header);
    columns.push({ header, index });
  });

  const rows: RawRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => c == null || String(c).trim() === "")) {
      continue;
    }
    const row: RawRow = {};
    for (const { header, index } of columns) {
      row[header] = cells[index] == null ? "" : String(cells[index]);
    }
    row[SHEET_ROW_KEY] = String(r + 1);
    rows.push(row);
  }
  return rows;
}
