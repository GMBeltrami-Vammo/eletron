import "server-only";

/**
 * Server-action plumbing: the `withOperator` wrapper runs the session +
 * operator gate, hands the callback a user-scoped charging client, and turns
 * thrown/RPC errors into a typed `ActionResult` (never leaks a stack to the
 * client). RPCs already raise pt-BR messages from Postgres.
 */

import { getSessionEmail, isOperatorEmail, userClientFor, type UserClient } from "./guards";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Authorizes an operator, then runs `fn(client, email)`. Returns
 * `{ ok:false, error }` on auth failure or any thrown error.
 */
export async function withOperator<T>(
  fn: (client: UserClient, email: string) => Promise<T>,
): Promise<ActionResult<T>> {
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "não autenticado" };
  const client = await userClientFor(email);
  if (!(await isOperatorEmail(client, email))) {
    return { ok: false, error: "permissão de operador necessária" };
  }
  try {
    const data = await fn(client, email);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Throws the Supabase RPC error (pt-BR message) so `withOperator` can surface it. */
export function unwrapRpc<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
