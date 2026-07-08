import "server-only";

/**
 * Shared viewer-role reader for the Phase 2 write screens (/pagamentos,
 * /alertas, /admin). Lives under components/admin because roles are an admin
 * concept, but it is app-wide: every gated server component calls it once and
 * passes the derived booleans down to its client view.
 *
 * Identity comes from the next-auth `@vammo.com` session; the exact role is
 * read from `charging.user_roles` via the service-role client (server
 * components already sit behind the auth middleware gate — same rationale as
 * repository.server.ts). Degrades to `role: null` when Supabase env is absent
 * or the read fails, so dev/sheets mode never crashes — it just renders every
 * write control disabled. Postgres re-checks the role inside each RPC, so this
 * is a UX affordance, never the security boundary.
 */

import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
  if (!email) {
    return { email: null, role: null, supabaseConfigured: hasSupabaseEnv() };
  }
  try {
    const { data, error } = await supabaseAdmin()
      .from("user_roles")
      .select("role")
      .eq("email", email)
      .maybeSingle();
    if (error) return { email, role: null, supabaseConfigured: true };
    const role = (data as { role?: string } | null)?.role ?? null;
    return {
      email,
      role: role === "admin" ? "admin" : role === "operator" ? "operator" : null,
      supabaseConfigured: true,
    };
  } catch {
    return { email, role: null, supabaseConfigured: false };
  }
}
