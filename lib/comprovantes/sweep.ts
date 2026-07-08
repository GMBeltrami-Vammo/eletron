/**
 * Sweep of comprovante documents left `processing_status='pending'` — upload
 * deferrals and crashed runs. Extracted from the drive-poll route so the daily
 * catch-up cron (Phase 2.5 chain: metabase-sync → alerts-eval → sweep) can run
 * it without the Drive listing. Idempotent: processing stamps a terminal
 * status, so a re-run only picks up rows still pending.
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
