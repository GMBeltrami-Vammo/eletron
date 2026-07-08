"use server";

/**
 * Client-callable read action for polling the Jobs card while a run is in
 * progress. Any authenticated @vammo.com user may read job_runs (RLS
 * is_vammo_user); this action re-checks the session before returning rows.
 * Colocated under components/admin so the client card imports it without a
 * route-group parenthesis in the specifier.
 */

import { getSessionEmail } from "@/lib/http/guards";
import type { ActionResult } from "@/lib/http/actions";
import { readJobRuns, type JobRunRow } from "./admin-data";

export async function refreshJobRuns(
  limit = 50,
): Promise<ActionResult<JobRunRow[]>> {
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "não autenticado" };
  const result = await readJobRuns(limit);
  if (!result.configured) {
    return { ok: false, error: "Supabase não configurado" };
  }
  return { ok: true, data: result.rows };
}
