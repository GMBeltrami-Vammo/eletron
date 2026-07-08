import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for background jobs (sheet-sync, alerts-eval,
 * comprovante pipeline, backfill) and the Drive-upload routes AFTER session
 * authz. Bypasses RLS — never expose to the client, never build from a
 * client-supplied identity. `server-only` fails the build if imported into a
 * client component.
 *
 * Env name is `SUPABASE_SERVICE_ROLE_KEY` (security-ops naming); goBuy calls
 * the same value `SUPABASE_SECRET_KEY` — divergence recorded in decisions.md.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured",
    );
  }
  return createClient(url, serviceKey, {
    db: { schema: "charging" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
