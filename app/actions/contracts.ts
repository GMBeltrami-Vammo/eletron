"use server";

/**
 * Contract curation actions (R4): toggle the rent_manual flag (Ipiranga /
 * Smart Kitchens curation — M7) via the set_rent_manual RPC. cancel_contract
 * lives in alterations.ts. Roles suspended → any @vammo.com session.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

export async function setRentManual(input: {
  contractId: string;
  manual: boolean;
  cadastroId: number;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("set_rent_manual", {
        p_contract_id: input.contractId,
        p_manual: input.manual,
      }),
    );
    revalidatePath(`/alugueis/${input.cadastroId}`);
    revalidatePath("/alugueis");
    revalidatePath("/mensal");
    await revalidateSnapshot();
  });
}
