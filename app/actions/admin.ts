"use server";

/**
 * Admin actions. These RPCs require the `admin` role, enforced INSIDE Postgres
 * (`is_admin()`); `withOperator` is the coarse pre-gate, and the RPC raises
 * "admin role required" for a mere operator — Postgres is the final authority.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

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
