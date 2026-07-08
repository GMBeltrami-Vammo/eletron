"use server";

/**
 * Admin-surface server actions.
 *
 * The RPC-backed actions (setUserRole, assignStationToAccount) run behind the
 * coarse `withOperator` pre-gate and let Postgres be the final authority.
 *
 * ROLES SUSPENDED (Phase 2.5, Gabriel 2026-07-08): `withOperator`/`withAdmin`
 * now only require an authenticated @vammo.com session; migration 8 redefines
 * is_operator()/is_admin() to is_vammo_user() in Postgres. `setUserRole` stays
 * exported but dormant (its /admin card is hidden) for when roles return.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAlertsEval } from "@/lib/sync/alerts-eval";
import { runMetabaseSync } from "@/lib/sync/metabase-sync";

/** Grant/change/remove a user's role. `role: null` removes it (last-admin guarded). */
export async function setUserRole(input: {
  email: string;
  role: "admin" | "operator" | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("set_user_role", {
        p_email: input.email,
        p_role: input.role,
      }),
    );
    revalidatePath("/admin");
  });
}

/** Remap a billing account to a station (cascades to its unattributed charges). */
export async function assignStationToAccount(input: {
  billingAccountId: string;
  stationId: number;
  method?: string | null;
  note?: string | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("assign_station_to_account", {
        p_billing_account_id: input.billingAccountId,
        p_station_id: input.stationId,
        p_method: input.method ?? null,
        p_note: input.note ?? null,
      }),
    );
    revalidatePath("/admin");
    revalidatePath("/revisao/instalacoes");
    await revalidateSnapshot();
  });
}

/**
 * Session gate for actions that have NO Postgres RPC behind them (here:
 * `runJobNow`, which drives the cores with the service role). ROLES SUSPENDED
 * (Gabriel, 2026-07-08 — test environment): any authenticated @vammo.com
 * session passes; the `user_roles` admin lookup that lived here is the
 * restoration point if roles return.
 */
async function withAdmin<T>(
  fn: (email: string) => Promise<T>,
): Promise<ActionResult<T>> {
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "não autenticado" };
  try {
    return { ok: true, data: await fn(email) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Manual trigger for the scheduled jobs. Runs the same cores the Vercel cron
 * uses, tagged `manual:{email}`:
 *   'metabase-sync' → runMetabaseSync (cards 28816 + 28556 → stations)
 *   'alerts-eval'   → runAlertsEval
 *   'daily'         → metabase-sync then alerts-eval (the catch-up order)
 * Awaits the full run, then revalidates /admin so the Jobs table reflects it.
 * Errors are wrapped into the ActionResult by `withAdmin` — never thrown to
 * the client.
 */
export async function runJobNow(
  job: "metabase-sync" | "alerts-eval" | "daily",
): Promise<ActionResult> {
  return withAdmin(async (email) => {
    const admin = supabaseAdmin();
    const trigger = `manual:${email}`;
    if (job === "metabase-sync") {
      await runMetabaseSync({ admin, trigger });
    } else if (job === "alerts-eval") {
      await runAlertsEval({ admin, trigger });
    } else {
      await runMetabaseSync({ admin, trigger });
      await runAlertsEval({ admin, trigger });
    }
    revalidatePath("/admin");
  });
}
