"use server";

/**
 * Charge/contract alteration actions (R4): pro-rata / delayed-debt amount &
 * due-date overrides (adjust_charge) and box/contract cancellation
 * (cancel_contract). RPC-backed, behind `withOperator` (roles suspended). Both
 * RPCs require a reason and refuse terminal states (pago / already-inactive).
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

export async function adjustCharge(input: {
  chargeId: string;
  newAmount?: number | null;
  newDueDate?: string | null;
  reason: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    if (input.newAmount == null && !input.newDueDate) {
      throw new Error("informe um novo valor e/ou uma nova data de vencimento");
    }
    if (!input.reason.trim()) throw new Error("informe o motivo do ajuste");
    unwrapRpc(
      await client.rpc("adjust_charge", {
        p_charge_id: input.chargeId,
        p_new_amount: input.newAmount ?? null,
        p_new_due_date: input.newDueDate ?? null,
        p_reason: input.reason.trim(),
      }),
    );
    revalidatePath("/pagamentos");
    revalidatePath("/mensal");
    await revalidateSnapshot();
  });
}

export async function cancelContract(input: {
  contractId: string;
  reason: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    if (!input.reason.trim()) throw new Error("informe o motivo do cancelamento");
    unwrapRpc(
      await client.rpc("cancel_contract", {
        p_contract_id: input.contractId,
        p_reason: input.reason.trim(),
      }),
    );
    revalidatePath("/alugueis");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();
  });
}
