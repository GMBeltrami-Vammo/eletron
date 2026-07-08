/**
 * The one Node-only raw-tabs entry point: live Google Sheets when the env vars
 * are present, xlsx fixtures otherwise (dev/test/backfill). Node-only
 * (googleapis/xlsx/fs) — import from server code only (repository.server.ts,
 * cron routes, scripts). Kept free of Next.js imports so the backfill script
 * and route handlers can share it without dragging in the framework runtime.
 */

import { loadRawTabsFromFixtures } from "./fixtures-loader";
import { loadRawTabsFromSheets, sheetsEnvPresent } from "./sheets-loader";
import type { RawTabs } from "./raw-tabs";

/** Live Sheets when GSHEETS_* env vars are set, xlsx fixtures otherwise. */
export async function loadRawTabs(): Promise<RawTabs> {
  if (sheetsEnvPresent()) {
    return loadRawTabsFromSheets();
  }
  return loadRawTabsFromFixtures();
}
