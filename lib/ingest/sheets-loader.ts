/**
 * Google Sheets reader — the live Phase 1 data source.
 *
 * Node-only (googleapis); import exclusively from server-side code
 * (lib/data/repository.server.ts). Auth comes from GSHEETS_SA_KEY_B64
 * (base64-encoded service-account JSON with Viewer access to both
 * spreadsheets).
 *
 * API-call budget: values.batchGet cannot mix valueRenderOptions in one call,
 * so the scraper spreadsheet needs two batchGets (FORMATTED_VALUE for the
 * state tabs, FORMULA for the two Faturas tabs whose link_fatura cells are
 * =HYPERLINK formulas) and the rent spreadsheet needs one — 3 HTTP calls per
 * snapshot, total.
 *
 * The Faturas FORMULA fetch uses dateTimeRenderOption=FORMATTED_STRING so
 * date cells come back as displayed strings (never serial numbers); plain
 * number cells come back as JSON numbers and are stringified — normalize.ts
 * parses both locale renderings.
 */

import { google } from "googleapis";
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

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/**
 * Env shape (structurally compatible with process.env):
 * GSHEETS_SA_KEY_B64, SCRAPER_SPREADSHEET_ID, RENT_SPREADSHEET_ID.
 */
export type SheetsLoaderEnv = Record<string, string | undefined>;

/** True when all three env vars needed for a live Sheets read are present. */
export function sheetsEnvPresent(env: SheetsLoaderEnv = process.env): boolean {
  return Boolean(
    env.GSHEETS_SA_KEY_B64 &&
      env.SCRAPER_SPREADSHEET_ID &&
      env.RENT_SPREADSHEET_ID,
  );
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function parseServiceAccountKey(b64: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch (err) {
    throw new Error(
      `GSHEETS_SA_KEY_B64 is not valid base64-encoded JSON: ${String(err)}`,
    );
  }
  const key = parsed as Partial<ServiceAccountKey>;
  if (
    typeof key.client_email !== "string" ||
    typeof key.private_key !== "string"
  ) {
    throw new Error(
      "GSHEETS_SA_KEY_B64 JSON is missing client_email/private_key",
    );
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

/**
 * Authenticated read-only Sheets client from GSHEETS_SA_KEY_B64. Shared by the
 * Phase 1 snapshot loader below and the FISCAL-sheet check (lib/fiscal) — the
 * service account must be a Viewer on every spreadsheet it reads.
 */
export function createSheetsClient(
  env: SheetsLoaderEnv = process.env,
): ReturnType<typeof google.sheets> {
  if (!env.GSHEETS_SA_KEY_B64) {
    throw new Error("GSHEETS_SA_KEY_B64 not configured");
  }
  const key = parseServiceAccountKey(env.GSHEETS_SA_KEY_B64);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [SHEETS_SCOPE],
  });
  return google.sheets({ version: "v4", auth });
}

/** batchGet value cell → string (numbers/booleans stringified, null → ''). */
function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  return String(cell);
}

function valuesToGrid(values: unknown[][] | null | undefined): string[][] {
  if (!values) return [];
  return values.map((row) => row.map(cellToString));
}

/** Quotes a tab name for an A1 range ("'2_Pagamentos'"). */
function tabRange(tab: TabName): string {
  return `'${tab}'`;
}

async function batchGetGrids(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabs: readonly TabName[],
  render: "FORMATTED_VALUE" | "FORMULA",
): Promise<Map<TabName, string[][]>> {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: tabs.map(tabRange),
    valueRenderOption: render,
    ...(render === "FORMULA"
      ? { dateTimeRenderOption: "FORMATTED_STRING" }
      : {}),
  });
  const out = new Map<TabName, string[][]>();
  const valueRanges = res.data.valueRanges ?? [];
  tabs.forEach((tab, i) => {
    out.set(tab, valuesToGrid(valueRanges[i]?.values as unknown[][] | undefined));
  });
  return out;
}

/**
 * Loads all nine Phase 1 tabs from the two spreadsheets into RawTabs.
 * Throws when env vars are missing — callers decide the fixture fallback.
 */
export async function loadRawTabsFromSheets(
  env: SheetsLoaderEnv = process.env,
): Promise<RawTabs> {
  if (!sheetsEnvPresent(env)) {
    throw new Error(
      "Missing Sheets env vars (GSHEETS_SA_KEY_B64, SCRAPER_SPREADSHEET_ID, RENT_SPREADSHEET_ID)",
    );
  }
  const sheets = createSheetsClient(env);

  const scraperFormattedTabs = SCRAPER_TABS.filter((t) => !FORMULA_TABS.has(t));
  const scraperFormulaTabs = SCRAPER_TABS.filter((t) => FORMULA_TABS.has(t));

  const [scraperFormatted, scraperFormula, rentFormatted] = await Promise.all([
    batchGetGrids(
      sheets,
      env.SCRAPER_SPREADSHEET_ID as string,
      scraperFormattedTabs,
      "FORMATTED_VALUE",
    ),
    batchGetGrids(
      sheets,
      env.SCRAPER_SPREADSHEET_ID as string,
      scraperFormulaTabs,
      "FORMULA",
    ),
    batchGetGrids(
      sheets,
      env.RENT_SPREADSHEET_ID as string,
      RENT_TABS,
      "FORMATTED_VALUE",
    ),
  ]);

  const grids = new Map<TabName, string[][]>([
    ...scraperFormatted,
    ...scraperFormula,
    ...rentFormatted,
  ]);

  const tabs = {} as RawTabs;
  for (const tab of [...SCRAPER_TABS, ...RENT_TABS]) {
    tabs[tab] = gridToRows(tab, grids.get(tab) ?? []);
  }
  return tabs;
}
