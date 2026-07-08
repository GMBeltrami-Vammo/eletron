"use server";

/**
 * Charge / payment write actions. All take the internal charging uuid (the UX
 * layer resolves dedupe_key → uuid from its direct reads, H3). Semantics live in
 * the RPCs: `pago` is only reachable via `record_payment` (when covered) or
 * `confirm_charge` (the human gate over auto-matched `conciliado`) — never via
 * `update_charge_status` (decision #24, transition allow-list).
 */

import { revalidatePath } from "next/cache";

import type { ChargeStatus, PaymentMethod } from "@/lib/domain";
import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

async function revalidateCharges(): Promise<void> {
  revalidatePath("/pagamentos");
  revalidatePath("/energia");
  revalidatePath("/revisao/comprovantes");
  revalidatePath("/revisao/cobrancas");
  await revalidateSnapshot();
}

export interface RecordPaymentInput {
  chargeId: string;
  /** receipt uuid, or null for a receiptless "Pago". */
  receiptId?: string | null;
  amount: number;
  /** ISO `YYYY-MM-DD`. */
  paidAt?: string | null;
  method?: PaymentMethod | null;
}

/** Records a human payment (flips to `pago` when coverage ≥ amount). Returns the payment uuid. */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ActionResult<string>> {
  return withOperator(async (client) => {
    const id = unwrapRpc(
      await client.rpc("record_payment", {
        p_charge_id: input.chargeId,
        p_receipt_id: input.receiptId ?? null,
        p_amount: input.amount,
        p_paid_at: input.paidAt ?? null,
        p_method: input.method ?? null,
      }),
    ) as string;
    await revalidateCharges();
    return id;
  });
}

/** Deletes a payment and walks the charge status back if it becomes under-covered. */
export async function unmatchPayment(input: {
  paymentId: string;
  reason: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("unmatch_payment", {
        p_payment_id: input.paymentId,
        p_reason: input.reason,
      }),
    );
    await revalidateCharges();
  });
}

/** Human gate: confirms an auto-matched `conciliado` charge → `pago` (named actor). */
export async function confirmCharge(input: {
  chargeId: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(await client.rpc("confirm_charge", { p_charge_id: input.chargeId }));
    await revalidateCharges();
  });
}

/** Moves a charge to a non-`pago`, non-`conciliado` status (allow-list enforced in the RPC). */
export async function updateChargeStatus(input: {
  chargeId: string;
  newStatus: ChargeStatus;
  reason: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("update_charge_status", {
        p_charge_id: input.chargeId,
        p_new_status: input.newStatus,
        p_reason: input.reason,
      }),
    );
    await revalidateCharges();
  });
}

export interface GerarMesResult {
  created: number;
  skipped_existing: number;
  flagged: number;
}

/** Generates the month's rent charges (port of A5). `competencia` is any date in the month. */
export async function gerarMes(input: {
  competencia: string;
}): Promise<ActionResult<GerarMesResult>> {
  return withOperator(async (client) => {
    const summary = unwrapRpc(
      await client.rpc("gerar_mes", { p_competencia: input.competencia }),
    ) as GerarMesResult;
    revalidatePath("/pagamentos");
    revalidatePath("/alugueis");
    await revalidateSnapshot();
    return summary;
  });
}

/** Attributes an UNIDENTIFIED charge to a billing account (cascades station). */
export async function resolveUnmatchedCharge(input: {
  chargeId: string;
  billingAccountId: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("resolve_unmatched_charge", {
        p_charge_id: input.chargeId,
        p_billing_account_id: input.billingAccountId,
      }),
    );
    revalidatePath("/revisao/cobrancas");
    await revalidateSnapshot();
  });
}
