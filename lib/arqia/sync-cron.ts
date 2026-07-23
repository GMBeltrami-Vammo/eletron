import "server-only";

/**
 * ARQIA daily sync under a job lease ('arqia-sync') — mirrors
 * runFiscalSendCron/metabase-sync so overlapping cron firings can't double-run.
 * No-ops (unconfigured) without the Arqia envs. Wired into /api/cron/daily.
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import { claimJob, finalizeJob } from "@/lib/sync/job-runs";
import { arqiaEnv } from "./client";
import { runArqiaSync, type ArqiaSyncResult } from "./sync";

export const ARQIA_SYNC_JOB_NAME = "arqia-sync";

export type ArqiaSyncCronResult =
  | { status: "unconfigured" }
  | { status: "skipped_locked" }
  | { status: "success"; jobId: string; result: ArqiaSyncResult };

export async function runArqiaSyncCron(
  admin: ChargingClient,
  trigger: string,
  sendAlerts: boolean,
): Promise<ArqiaSyncCronResult> {
  if (!arqiaEnv()) return { status: "unconfigured" };

  const jobId = await claimJob(admin, ARQIA_SYNC_JOB_NAME);
  if (!jobId) return { status: "skipped_locked" };

  try {
    const result = await runArqiaSync(admin, new Date(), { sendAlerts });
    await finalizeJob(admin, jobId, {
      status: "success",
      trigger,
      stats: result.status === "success" ? { ...result } : { status: result.status },
    });
    return { status: "success", jobId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(admin, jobId, { status: "error", trigger, error: message }).catch(
      () => {},
    );
    throw err;
  }
}
