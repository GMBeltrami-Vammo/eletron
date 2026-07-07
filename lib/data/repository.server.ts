/**
 * Server-side repository wiring — the ONLY module that touches Node-only
 * loaders (googleapis/xlsx/fs) and the Next.js cache runtime. Screens import
 * `getRepository()` from here; tests instantiate SheetSnapshotRepository
 * directly from repository.ts with an injected loader.
 *
 * Caching layers:
 * - `unstable_cache` keeps the RAW tabs for 15 min (revalidate 900s) under the
 *   'sheet-snapshot' tag, shared across requests;
 * - React `cache()` gives one repository instance (and thus one
 *   normalize/derive pass) per request render.
 *
 * `revalidateSnapshot()` busts the tag — call it from a server action or
 * route handler ("Atualizar agora" button / future cron).
 *
 * (The 'server-only' marker package is not among the scaffold's dependencies;
 * keeping this file import-clean of client code is enforced by convention —
 * do not import it from client components.)
 */

import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { loadRawTabsFromFixtures } from "@/lib/ingest/fixtures-loader";
import {
  loadRawTabsFromSheets,
  sheetsEnvPresent,
} from "@/lib/ingest/sheets-loader";
import type { RawTabs } from "@/lib/ingest/raw-tabs";
import { SheetSnapshotRepository, type Repository } from "./repository";

export const SNAPSHOT_CACHE_TAG = "sheet-snapshot";
export const SNAPSHOT_REVALIDATE_SECONDS = 900;

/** Live Sheets when the env vars are set, xlsx fixtures otherwise (dev). */
async function loadRawTabs(): Promise<RawTabs> {
  if (sheetsEnvPresent()) {
    return loadRawTabsFromSheets();
  }
  return loadRawTabsFromFixtures();
}

const cachedLoadRawTabs = unstable_cache(
  loadRawTabs,
  ["eletron-raw-tabs"],
  {
    revalidate: SNAPSHOT_REVALIDATE_SECONDS,
    tags: [SNAPSHOT_CACHE_TAG],
  },
);

/** One repository (one normalize pass) per request render. */
export const getRepository = cache(
  (): Repository => new SheetSnapshotRepository(cachedLoadRawTabs),
);

/**
 * Server-action helper: drops the cached raw tabs so the next render reloads
 * from Google Sheets. Wrap it in a 'use server' action (or call from a route
 * handler) — kept directive-free here so this module can also export values.
 */
export async function revalidateSnapshot(): Promise<void> {
  revalidateTag(SNAPSHOT_CACHE_TAG);
}
