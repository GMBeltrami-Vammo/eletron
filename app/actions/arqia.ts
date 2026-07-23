"use server";

/**
 * ARQIA write actions (Gabriel 2026-07-22): add mobile data bought this month
 * (create_arqia_data_purchase RPC) + trigger a sync on demand. Operator-gated
 * (withOperator); the sync runs as service-role (supabaseAdmin) since it writes
 * the arqia_* tables.
 */

import { revalidatePath } from "next/cache";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { runArqiaSyncCron } from "@/lib/arqia/sync-cron";

export async function createArqiaDataPurchase(input: {
  mb: number;
  note?: string | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    if (!(input.mb > 0)) throw new Error("informe os MB comprados (> 0)");
    unwrapRpc(
      await client.rpc("create_arqia_data_purchase", {
        p_mb: input.mb,
        p_note: input.note?.trim() || null,
      }),
    );
    revalidatePath("/arqia");
  });
}

export async function syncArqiaNow(): Promise<ActionResult> {
  return withOperator(async () => {
    await runArqiaSyncCron(supabaseAdmin(), "manual:arqia");
    revalidatePath("/arqia");
  });
}
