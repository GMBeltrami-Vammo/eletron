"use server";

/**
 * Matching-tool actions (R4, request 6): confirm a suggested station link or
 * reject an account as "não é Vammo". Both are RPC-backed (assign_station_to_
 * account / reject_account) and run behind `withOperator` (roles suspended →
 * any @vammo.com session). The geodesic suggestion + distance are carried into
 * the audit note; match_method is stamped 'geo_suggest' (or 'manual').
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

export async function confirmStationMatch(input: {
  billingAccountId: string;
  stationId: number;
  /** metres from the geodesic suggestion (null for a hand-picked station). */
  distanceM?: number | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    const note =
      input.distanceM != null
        ? `sugestão geodésica · ${Math.round(input.distanceM)} m`
        : "escolha manual";
    unwrapRpc(
      await client.rpc("assign_station_to_account", {
        p_billing_account_id: input.billingAccountId,
        p_station_id: input.stationId,
        p_method: input.distanceM != null ? "geo_suggest" : "manual",
        p_note: note,
      }),
    );
    revalidatePath("/revisao/instalacoes");
    revalidatePath("/revisao");
    await revalidateSnapshot();
  });
}

export async function rejectAccount(input: {
  billingAccountId: string;
  reason: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("reject_account", {
        p_billing_account_id: input.billingAccountId,
        p_reason: input.reason,
      }),
    );
    revalidatePath("/revisao/instalacoes");
    revalidatePath("/revisao");
    await revalidateSnapshot();
  });
}
