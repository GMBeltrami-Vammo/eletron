"use server";

/**
 * Contract curation + onboarding actions. R4: toggle the rent_manual flag
 * (Ipiranga / Smart Kitchens curation — M7) via set_rent_manual. Q10: confirm /
 * reject a staged contract_intake (the n8n contract webhook lands them
 * 'pending'; a human reviews then confirm → real contract + counterparty + rent
 * account). cancel_contract lives in alterations.ts. Roles suspended → any
 * @vammo.com session.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { normalizeCnpjCpf } from "@/lib/ingest/normalize";
import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";

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

export interface ConfirmContractIntakeInput {
  intakeId: string;
  swapStationId: number | null;
  status: StationStatus;
  contractType: ContractType;
  counterpartyName: string | null;
  counterpartyCnpj: string | null;
  numeroConexao: string | null;
  endereco: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  boxCount: number | null;
  minBox: number | null;
  valorPorBox: number | null;
  valorMensal: number | null;
  dueDay: number | null;
  paymentMethod: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  observacoes: string | null;
}

/** Confirm a staged intake → creates the contract. Returns the new contract id. */
export async function confirmContractIntake(
  input: ConfirmContractIntakeInput,
): Promise<ActionResult<string>> {
  return withOperator(async (client) => {
    // CPF/CNPJ is normalized right before the RPC (restores stripped leading
    // zeros; nulls real garbage) so it passes the counterparties.cnpj_cpf CHECK.
    const cnpj = input.counterpartyCnpj
      ? normalizeCnpjCpf(input.counterpartyCnpj)
      : null;

    const contractId = unwrapRpc(
      await client.rpc("confirm_contract_intake", {
        p_intake_id: input.intakeId,
        p_swap_station_id: input.swapStationId,
        p_status: input.status,
        p_contract_type: input.contractType,
        p_counterparty_name: input.counterpartyName,
        p_counterparty_cnpj: cnpj,
        p_numero_conexao: input.numeroConexao,
        p_endereco: input.endereco,
        p_contato: input.contato,
        p_telefone: input.telefone,
        p_email: input.email,
        p_box_count: input.boxCount,
        p_min_box: input.minBox,
        p_valor_por_box: input.valorPorBox,
        p_valor_mensal: input.valorMensal,
        p_due_day: input.dueDay,
        p_payment_method: input.paymentMethod,
        p_banco: input.banco,
        p_agencia: input.agencia,
        p_conta: input.conta,
        p_chave_pix: input.chavePix,
        p_observacoes: input.observacoes,
      }),
    ) as string;

    revalidatePath("/revisao/contratos");
    revalidatePath("/revisao");
    revalidatePath("/alugueis");
    await revalidateSnapshot();
    return contractId;
  });
}

/** Reject a staged intake (not a real contract). */
export async function rejectContractIntake(input: {
  intakeId: string;
  reason: string;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("reject_contract_intake", {
        p_intake_id: input.intakeId,
        p_reason: input.reason,
      }),
    );
    revalidatePath("/revisao/contratos");
    revalidatePath("/revisao");
  });
}
