/**
 * Server-side repository wiring — the ONLY module that touches Node-only
 * loaders (googleapis/xlsx/fs), the Supabase admin client, and the Next.js
 * cache runtime. Screens import `getRepository()` from here; tests instantiate
 * SheetSnapshotRepository / SupabaseRepository directly with an injected
 * loader or a (fake) client.
 *
 * Backends (decision #18, review-resolutions H3):
 * - 'sheets'   (default) — live Google Sheets / xlsx fixtures → normalize.
 * - 'supabase' — the `charging` schema. Reads go through `supabaseAdmin()`:
 *   server components are already behind the next-auth `@vammo.com` middleware
 *   gate, and the charging SELECT RLS policy is a uniform `is_vammo_user()`
 *   (no row-level filtering), so the service role returns the identical row set
 *   any vammo user would see. This mirrors Phase 1, where the Google service
 *   account reads all sheet data behind the same gate. Writes remain
 *   RLS/RPC-gated with per-call user tokens (decision #23) — unchanged here.
 *   Flipping the flag is an instant, deploy-free rollback.
 *
 * Caching layers (both backends):
 * - `unstable_cache` keeps the loaded snapshot for 15 min under the
 *   'sheet-snapshot' tag, shared across requests;
 * - React `cache()` gives one repository instance per request render.
 * `revalidateSnapshot()` busts the tag for whichever backend is active.
 */

import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { loadRawTabs } from "@/lib/ingest/load-raw";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadChargingSnapshot,
  SupabaseRepository,
} from "./supabase-repository";
import {
  SheetSnapshotRepository,
  type LoadedSnapshot,
  type Repository,
} from "./repository";

export const SNAPSHOT_CACHE_TAG = "sheet-snapshot";
export const SNAPSHOT_REVALIDATE_SECONDS = 900;

type Backend = "sheets" | "supabase";

function backend(): Backend {
  return process.env.REPOSITORY_BACKEND === "supabase" ? "supabase" : "sheets";
}

// ── sheets backend: cache the RAW tabs, normalize per request ───────────────
const cachedLoadRawTabs = unstable_cache(loadRawTabs, ["eletron-raw-tabs"], {
  revalidate: SNAPSHOT_REVALIDATE_SECONDS,
  tags: [SNAPSHOT_CACHE_TAG],
});

// ── supabase backend: cache the assembled snapshot (LoadedSnapshot) ─────────
const cachedChargingSnapshot = unstable_cache(
  (): Promise<LoadedSnapshot> => loadChargingSnapshot(supabaseAdmin(), new Date()),
  ["eletron-charging-snapshot"],
  { revalidate: SNAPSHOT_REVALIDATE_SECONDS, tags: [SNAPSHOT_CACHE_TAG] },
);

/** One repository (one normalize/assemble pass) per request render. */
export const getRepository = cache((): Repository => {
  if (backend() === "supabase") {
    // The cached loader owns the snapshot fetch; the client arg is unused when
    // a loader is injected, but kept so the same class serves jobs/backfill.
    return new SupabaseRepository(
      supabaseAdmin(),
      () => new Date(),
      cachedChargingSnapshot,
    );
  }
  return new SheetSnapshotRepository(cachedLoadRawTabs);
});

/**
 * Server-action helper: drops the cached snapshot so the next render reloads
 * from the active backend. Wrap it in a 'use server' action (or call from a
 * route handler) — kept directive-free here so this module can also export
 * values.
 */
export async function revalidateSnapshot(): Promise<void> {
  revalidateTag(SNAPSHOT_CACHE_TAG);
}
