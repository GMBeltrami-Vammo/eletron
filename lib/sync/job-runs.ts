/**
 * Shared job_runs lifecycle helpers for the sync jobs (sheet-sync, alerts-eval,
 * daily catch-up). `claim_job` is a service_role-only RPC that inserts the
 * 'running' row and enforces the lease; finalize stamps the outcome + stats.
 * Server-only by convention (service-role writes).
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";

/**
 * Leases a job. Returns the new job_runs id, or null when another run of the
 * same job still holds a live lease (skip — don't run).
 */
export async function claimJob(
  admin: ChargingClient,
  jobName: string,
  leaseSeconds = 600,
): Promise<string | null> {
  const { data, error } = await admin.rpc("claim_job", {
    p_job_name: jobName,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim_job(${jobName}) failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/** Stamps finished_at + the given patch (status/trigger/stats/error) on a run. */
export async function finalizeJob(
  admin: ChargingClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("job_runs")
    .update({ finished_at: new Date().toISOString(), ...patch })
    .eq("id", jobId);
  if (error) throw new Error(`finalize job_runs failed: ${error.message}`);
}
