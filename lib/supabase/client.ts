import { createClient } from "@supabase/supabase-js";

/**
 * A Supabase client scoped to the `charging` schema and authenticated AS a
 * user via a minted token (see lib/supabase/token.ts). RLS + every RPC's
 * role checks apply — Postgres is the final authority. `persistSession`/
 * `autoRefreshToken` are off: the token is per-request, minted server-side.
 */
export function supabaseForUser(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not configured");
  }
  return createClient(url, anonKey, {
    db: { schema: "charging" },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
