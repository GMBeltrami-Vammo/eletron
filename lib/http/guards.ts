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
 * Whether `email` has a write role (operator OR admin). Uses the user token's
 * SELECT on `user_roles` (RLS); a query error fails closed.
 */
export async function isOperatorEmail(
  client: UserClient,
  email: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("email", email)
    .maybeSingle();
  if (error) return false;
  const role = (data as { role?: string } | null)?.role;
  return role === "admin" || role === "operator";
}
