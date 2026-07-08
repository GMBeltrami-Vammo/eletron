import "server-only";

/**
 * Shared viewer-role reader for the Phase 2 write screens (/pagamentos,
 * /alertas, /admin). Lives under components/admin because roles are an admin
 * concept, but it is app-wide: every gated server component calls it once and
 * passes the derived booleans down to its client view.
 *
 * ROLES SUSPENDED (Gabriel, 2026-07-08 — test environment): any authenticated
 * @vammo.com session gets full write affordances (`role: "admin"`), matching
 * migration 8's is_operator()/is_admin() → is_vammo_user() in Postgres.
 * Restoration point = the `charging.user_roles` read that lived here.
 * Still degrades to `role: null` when Supabase env is absent, so dev/sheets
 * mode renders write controls disabled (they would fail anyway).
 */

import { getSessionEmail } from "@/lib/http/guards";

export type ViewerRole = "admin" | "operator" | null;

export interface Viewer {
  email: string | null;
  role: ViewerRole;
  /** Whether the Supabase charging backend is reachable (env present). */
  supabaseConfigured: boolean;
}

function hasSupabaseEnv(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function getViewer(): Promise<Viewer> {
  const email = await getSessionEmail();
  const supabaseConfigured = hasSupabaseEnv();
  return {
    email,
    role: email && supabaseConfigured ? "admin" : null,
    supabaseConfigured,
  };
}
