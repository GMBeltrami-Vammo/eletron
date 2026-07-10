/**
 * Sweep of comprovante documents left `processing_status='pending'` — the
 * crash-recovery net now that intake is app-upload only (the n8n drive-poll is
 * gone, 2026-07-10). A doc is 'pending' when its client-driven chunk loop never
 * finished (tab closed mid-upload); the daily catch-up cron (Phase 2.5 chain:
 * metabase-sync → alerts-eval → sweep) reprocesses it WHOLE via
 * processComprovanteDocument. Idempotent: receipts upsert, payments are unique,
 * page isolation is upsert-by-path, and the flip only fires from OPEN — so a
 * fully-processed doc that is somehow still 'pending' converges without harm.
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import { processComprovanteDocument } from "@/lib/comprovantes/pipeline";

const OVERLAP_MS = 2 * 60 * 1000;
const SWEEP_LIMIT = 50;

export interface SweepStats {
  swept: number;
  failed: number;
}

/** Processes up to SWEEP_LIMIT comprovantes stuck `pending` for >2 minutes. */
export async function sweepComprovantes(admin: ChargingClient): Promise<SweepStats> {
  const twoMinAgo = new Date(Date.now() - OVERLAP_MS).toISOString();
  const { data: stale, error } = await admin
    .from("documents")
    .select("id")
    .eq("processing_status", "pending")
    .eq("kind", "comprovante")
    .lt("created_at", twoMinAgo)
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(`sweep read failed: ${error.message}`);

  const stats: SweepStats = { swept: 0, failed: 0 };
  for (const row of (stale ?? []) as { id: string }[]) {
    const r = await processComprovanteDocument(row.id, admin);
    stats.swept += 1;
    if (r.status === "failed") stats.failed += 1;
  }
  return stats;
}
