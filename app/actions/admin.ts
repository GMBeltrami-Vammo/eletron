"use server";

/**
 * Admin-surface server actions.
 *
 * The RPC-backed actions (setUserRole, assignStationToAccount) run behind the
 * coarse `withOperator` pre-gate and let Postgres be the final authority — the
 * RPC re-checks the role inside the transaction (set_user_role raises for a
 * non-admin).
 *
 * `runJobNow` is the exception: it drives the sync/alerts cores directly with
 * the service-role client (no RPC, hence no in-Postgres gate), so it carries
 * its OWN explicit admin gate — `withAdmin`, a fail-closed read of the caller's
 * role through their user token (RLS) — before it ever touches the service role.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { getSessionEmail, userClientFor } from "@/lib/http/guards";
import { loadRawTabs } from "@/lib/ingest/load-raw";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAlertsEval } from "@/lib/sync/alerts-eval";
import { runSheetSync } from "@/lib/sync/sheet-sync";

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
 * Admin-only gate for actions that have NO Postgres RPC to enforce the role
 * (here: `runJobNow`, which drives the cores with the service role). Mirrors
 * `withOperator` but requires `role='admin'`, read through the caller's own
 * user token so RLS applies; any missing/failed read fails closed. Postgres
 * can't be the authority for these actions, so this app-layer check is it.
 */
async function withAdmin<T>(
  fn: (email: string) => Promise<T>,
): Promise<ActionResult<T>> {
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "não autenticado" };
  const client = await userClientFor(email);
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("email", email)
    .maybeSingle();
  if (error || (data as { role?: string } | null)?.role !== "admin") {
    return { ok: false, error: "permissão de administrador necessária" };
  }
  try {
    return { ok: true, data: await fn(email) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Manual trigger for the scheduled jobs (admin only). Runs the same cores the
 * n8n / Vercel crons use, tagged `manual:{email}`:
 *   'sheet-sync'  → runSheetSync
 *   'alerts-eval' → runAlertsEval
 *   'daily'       → sheet-sync then alerts-eval (the catch-up order)
 * Awaits the full run, then revalidates /admin so the Jobs table reflects it.
 * Errors are wrapped into the ActionResult by `withAdmin` — never thrown to
 * the client.
 */
export async function runJobNow(
  job: "sheet-sync" | "alerts-eval" | "daily",
): Promise<ActionResult> {
  return withAdmin(async (email) => {
    const admin = supabaseAdmin();
    const trigger = `manual:${email}`;
    if (job === "sheet-sync") {
      await runSheetSync({ admin, loadRaw: loadRawTabs, trigger });
    } else if (job === "alerts-eval") {
      await runAlertsEval({ admin, trigger });
    } else {
      await runSheetSync({ admin, loadRaw: loadRawTabs, trigger });
      await runAlertsEval({ admin, trigger });
    }
    revalidatePath("/admin");
  });
}
