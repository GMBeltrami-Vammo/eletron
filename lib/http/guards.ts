import "server-only";

/**
 * Shared auth/authz helpers for Phase 2 write routes + server actions
 * (security-ops §1.2/§5.1). Every mutating surface runs, in order:
 *   same-origin (routes) → next-auth `@vammo.com` session → `is_operator`.
 * Actor identity always comes from the session; the RPC re-derives it from
 * `jwt_email()` inside Postgres.
 */

import { auth } from "@/auth";
import { supabaseForUser } from "@/lib/supabase/client";
import { mintSupabaseToken } from "@/lib/supabase/token";

export type UserClient = ReturnType<typeof supabaseForUser>;

/**
 * CSRF defense-in-depth: rejects only an EXPLICIT cross-origin request (Origin
 * present and its host ≠ the request Host). Missing Origin is allowed (some
 * legitimate clients omit it); the session gate is the primary defense.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Session email lowercased, or null when unauthenticated / not `@vammo.com`. */
export async function getSessionEmail(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() ?? null;
  if (!email || !email.endsWith("@vammo.com")) return null;
  return email;
}

/** A charging client authenticated AS `email` (per-call minted token, RLS applies). */
export async function userClientFor(email: string): Promise<UserClient> {
  return supabaseForUser(await mintSupabaseToken(email));
}

/**
 * ROLES SUSPENDED (Gabriel, 2026-07-08 — test environment): any authenticated
 * @vammo.com session may write. Migration 8 redefines charging.is_operator()/
 * is_admin() to is_vammo_user() in Postgres; this mirrors it app-side. The
 * signature is kept so the ~15 call sites stay untouched and roles can return
 * later by restoring the user_roles lookup that lived here.
 */
export async function isOperatorEmail(
  _client: UserClient,
  email: string,
): Promise<boolean> {
  return email.endsWith("@vammo.com");
}
