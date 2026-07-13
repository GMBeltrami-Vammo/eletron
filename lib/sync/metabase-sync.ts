/**
 * Metabase → charging.stations direct sync (Phase 2.5 / R0).
 *
 * Replaces the sheet-borne 4_Metabase_Boxes path after the sheets sever: pulls
 * card 28816 (station registry: id, name, address, status, created_at) and
 * card 28556 (installed boxes; one row per active box) straight from the
 * Metabase API and upserts `stations.status/name/address/active_boxes/
 * boxes_synced_at`. This is what keeps "matches our Metabase" alive without
 * the spreadsheet intermediary.
 *
 * Semantics (plan M4): existing stations are UPDATED; stations present in
 * Metabase but absent from the clone are INSERTED with the card's fields
 * (coordinates stay null — the matching tool simply has no geo candidates for
 * them). Stations absent from card 28816 are left untouched (the existing
 * irregularidades logic surfaces them). Status mapping mirrors the Apps Script
 * (A4): ACTIVE → ACTIVE, DECOMMISSIONED → DECOMMISSIONED, PRE_INSTALLATION →
 * PRE_INSTALLATION, anything else → INACTIVE.
 *
 * Server-only by convention (service-role writes; METABASE_API_KEY).
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import { claimJob, finalizeJob } from "./job-runs";

const STATIONS_CARD_ID = 28816;
const BOXES_CARD_ID = 28556;

interface StationCardRow {
  station_id?: number | string | null;
  swap_station_name?: string | null;
  address?: string | null;
  status?: string | null;
  created_at?: string | null;
}

interface BoxCardRow {
  station_id?: number | string | null;
  /** fa.first_active_ts — when this box first went active (drives box-day pro-rata). */
  first_active_ts?: string | null;
}

export interface MetabaseSyncResult {
  jobId: string | null;
  skippedLocked: boolean;
  stationsSeen: number;
  updated: number;
  inserted: number;
}

function mapStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toUpperCase();
  if (s === "ACTIVE" || s === "DECOMMISSIONED" || s === "PRE_INSTALLATION") {
    return s;
  }
  return "INACTIVE";
}

function toStationId(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A box's first_active_ts → its BRT calendar date 'YYYY-MM-DD' (or null). We
 * store the BRT *date* so the box-day pro-rata (gerar_mes SQL + the TS preview)
 * is timezone-free and provably identical between the two. `en-CA` formats as
 * YYYY-MM-DD.
 */
function toBrtDate(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** POSTs a Metabase card query and returns its JSON rows. */
async function fetchCard<T>(cardId: number): Promise<T[]> {
  const base = process.env.METABASE_URL ?? "https://metabase.vammo.com";
  const apiKey = process.env.METABASE_API_KEY;
  if (!apiKey) throw new Error("METABASE_API_KEY not configured");
  const res = await fetch(`${base}/api/card/${cardId}/query/json`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    // Card queries can be slow; Metabase enforces its own timeout.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Metabase card ${cardId} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T[];
}

export async function runMetabaseSync(opts: {
  admin: ChargingClient;
  trigger: string;
}): Promise<MetabaseSyncResult> {
  const { admin, trigger } = opts;

  const jobId = await claimJob(admin, "metabase-sync");
  if (jobId === null) {
    return { jobId: null, skippedLocked: true, stationsSeen: 0, updated: 0, inserted: 0 };
  }
  await admin.from("job_runs").update({ trigger }).eq("id", jobId);

  try {
    const [stationRows, boxRows] = await Promise.all([
      fetchCard<StationCardRow>(STATIONS_CARD_ID),
      fetchCard<BoxCardRow>(BOXES_CARD_ID),
    ]);

    // Boxes card = one row per active box. Collect each station's box activation
    // dates (BRT); the count is just the array length. Full-replaced each run,
    // so removed boxes drop out (no stale entries) — decision #50.
    const boxActivationsByStation = new Map<number, (string | null)[]>();
    for (const row of boxRows) {
      const id = toStationId(row.station_id);
      if (id === null) continue;
      const arr = boxActivationsByStation.get(id) ?? [];
      arr.push(toBrtDate(row.first_active_ts));
      boxActivationsByStation.set(id, arr);
    }

    // Existing station ids (paginated — H3 discipline).
    const existing = new Set<number>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("stations")
        .select("id")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(`stations read failed: ${error.message}`);
      const rows = (data ?? []) as { id: number }[];
      rows.forEach((r) => existing.add(r.id));
      if (rows.length < 1000) break;
    }

    const now = new Date().toISOString();
    let updated = 0;
    let inserted = 0;
    const inserts: Record<string, unknown>[] = [];

    for (const row of stationRows) {
      const id = toStationId(row.station_id);
      if (id === null) continue;
      const activations = boxActivationsByStation.get(id) ?? [];
      const patch = {
        name: row.swap_station_name ?? null,
        address: row.address ?? null,
        status: mapStatus(row.status),
        active_boxes: activations.length,
        box_activations: activations,
        boxes_synced_at: now,
        synced_at: now,
      };
      if (existing.has(id)) {
        const { error } = await admin.from("stations").update(patch).eq("id", id);
        if (error) throw new Error(`station ${id} update failed: ${error.message}`);
        updated += 1;
      } else {
        inserts.push({
          id,
          ...patch,
          source_created_at: row.created_at ?? null,
          raw: { source: "metabase-sync", card: STATIONS_CARD_ID },
        });
      }
    }

    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const { error } = await admin.from("stations").insert(chunk);
      if (error) throw new Error(`stations insert failed: ${error.message}`);
      inserted += chunk.length;
    }

    await finalizeJob(admin, jobId, {
      status: "success",
      rows_read: stationRows.length,
      rows_upserted: updated + inserted,
      stats: { updated, inserted, boxesRows: boxRows.length },
    });
    return {
      jobId,
      skippedLocked: false,
      stationsSeen: stationRows.length,
      updated,
      inserted,
    };
  } catch (err) {
    await finalizeJob(admin, jobId, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
