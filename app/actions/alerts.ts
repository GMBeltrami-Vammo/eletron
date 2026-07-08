"use server";

/**
 * Alert lifecycle actions (P4 — the app's alerts panel is the record). Each RPC
 * enforces the open→acknowledged/resolved/muted state machine and writes one
 * audit event; the auto-resolve of rule-driven alerts stays in `alerts-eval`.
 */

import { revalidatePath } from "next/cache";

import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

async function revalidateAlerts(): Promise<void> {
  revalidatePath("/alertas");
}

/** Acknowledge an open alert. */
export async function acknowledgeAlert(input: {
  alertId: string;
  note?: string | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("acknowledge_alert", {
        p_alert_id: input.alertId,
        p_note: input.note ?? null,
      }),
    );
    await revalidateAlerts();
  });
}

/** Resolve an open/acknowledged alert. */
export async function resolveAlert(input: {
  alertId: string;
  note?: string | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("resolve_alert", {
        p_alert_id: input.alertId,
        p_note: input.note ?? null,
      }),
    );
    await revalidateAlerts();
  });
}

/** Mute an open/acknowledged alert. */
export async function muteAlert(input: {
  alertId: string;
  note?: string | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("mute_alert", {
        p_alert_id: input.alertId,
        p_note: input.note ?? null,
      }),
    );
    await revalidateAlerts();
  });
}
