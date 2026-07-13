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
import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { contractIntakePrefill, type ContractIntakePrefill } from "@/lib/ingest/contratos";
import { normalizeCnpjCpf } from "@/lib/ingest/normalize";
import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";

/**
 * "Contrato Ativo" toggle (#51): flip a contract ACTIVE↔INACTIVE. Inactivating
 * records `inactivated_on` (defaults to today) so gerar_mes pro-ratas the last
 * month. Human-only; any @vammo.com passes now (roles-per-action later).
 */
export async function setContractActive(input: {
  contractId: string;
  active: boolean;
  /** 'YYYY-MM-DD'; only used when inactivating. Defaults to today server-side. */
  inactivatedOn?: string | null;
  reason?: string | null;
  cadastroId?: number | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("set_contract_active", {
        p_contract_id: input.contractId,
        p_active: input.active,
        p_inactivated_on: input.active ? null : (input.inactivatedOn ?? null),
        p_reason: input.reason ?? null,
      }),
    );
    if (input.cadastroId != null) revalidatePath(`/alugueis/${input.cadastroId}`);
    revalidatePath("/alugueis");
    revalidatePath("/mensal");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();
  });
}

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

export interface ContractIntakePoll {
  available: boolean;
  status: "awaiting_extraction" | "pending" | "confirmed" | "rejected" | null;
  prefill: ContractIntakePrefill | null;
  documentId: string | null;
  nomeArquivo: string | null;
}

/**
 * Poll target for the /alugueis/novo drop-PDF flow (#48): reads a single intake
 * by id so the client can wait for `awaiting_extraction` → `pending` (n8n's AI
 * arrived) and then prefill the form. Session-gated (@vammo.com); returns a
 * benign empty result on any failure so the poll loop never throws.
 */
export async function pollContractIntake(intakeId: string): Promise<ContractIntakePoll> {
  const empty: ContractIntakePoll = {
    available: false,
    status: null,
    prefill: null,
    documentId: null,
    nomeArquivo: null,
  };
  try {
    const email = await getSessionEmail();
    if (!email) return empty;
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("contract_intake")
      .select("status, ai_extraction, document_id, nome_arquivo")
      .eq("id", intakeId)
      .maybeSingle();
    if (error || !data) return empty;
    const row = data as {
      status: ContractIntakePoll["status"];
      ai_extraction: Record<string, unknown> | null;
      document_id: string | null;
      nome_arquivo: string | null;
    };
    return {
      available: true,
      status: row.status,
      // only prefill once the extraction has actually landed (pending)
      prefill:
        row.status === "pending" ? contractIntakePrefill(row.ai_extraction ?? {}) : null,
      documentId: row.document_id,
      nomeArquivo: row.nome_arquivo,
    };
  } catch {
    return empty;
  }
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
