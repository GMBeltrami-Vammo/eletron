"use server";

/**
 * Email-cobrança review actions (R2, requirement 4): a human checks and, when
 * needed, reclassifies what the n8n webhook landed as `needs_review`. Both call
 * the `reclassify_charge` RPC (migration 8) — "Aprovar como está" simply
 * re-sends the current kind with no field changes, which flips match_status to
 * `manually_matched` (leaves the queue) and stamps status_source='rpc'.
 *
 * Roles suspended (decision #26): `withOperator` passes any @vammo.com session.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import type { UserClient } from "@/lib/http/guards";
import type { ChargeKind, PaymentMethod } from "@/lib/domain";

export interface ReclassifyInput {
  chargeId: string;
  kind: ChargeKind;
  /** 'YYYY-MM' or 'YYYY-MM-DD'; null = leave unchanged. */
  competencia?: string | null;
  /** 'YYYY-MM-DD'; null = leave unchanged (RPC coalesces). */
  dueDate?: string | null;
  amount?: number | null;
  expectedAmount?: number | null;
  /** Energia split amount → a single `energia` charge_line (null = no split). */
  energyAmount?: number | null;
  cadastroId?: number | null;
  stationId?: number | null;
  counterpartyName?: string | null;
  counterpartyCnpj?: string | null;
  paymentMethod?: PaymentMethod | null;
  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  chavePix?: string | null;
  codigoBoleto?: string | null;
  notes?: string | null;
}

function normalizeCompetencia(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** Full reclassify/patch of a needs-review charge via the RPC. */
export async function reclassifyCharge(
  input: ReclassifyInput,
): Promise<ActionResult<string>> {
  return withOperator(async (client) => {
    const competencia = normalizeCompetencia(input.competencia);
    // energia split → one `energia` charge_line (the composite-Valor "Energia").
    const lines =
      input.energyAmount != null && input.energyAmount > 0
        ? [
            {
              line_kind: "energia",
              description: "Energia (revisão)",
              amount: input.energyAmount,
              competencia,
            },
          ]
        : null;

    const chargeId = unwrapRpc(
      await client.rpc("reclassify_charge", {
        p_charge_id: input.chargeId,
        p_kind: input.kind,
        p_competencia: competencia,
        p_amount: input.amount ?? null,
        p_expected_amount: input.expectedAmount ?? null,
        p_lines: lines,
        p_cadastro_id: input.cadastroId ?? null,
        p_station_id: input.stationId ?? null,
        p_counterparty_name: input.counterpartyName ?? null,
        p_counterparty_cnpj: input.counterpartyCnpj ?? null,
        p_payment_method: input.paymentMethod ?? null,
        p_banco: input.banco ?? null,
        p_agencia: input.agencia ?? null,
        p_conta: input.conta ?? null,
        p_chave_pix: input.chavePix ?? null,
        p_codigo_boleto: input.codigoBoleto ?? null,
        p_notes: input.notes ?? null,
        p_due_date: input.dueDate ?? null,
      }),
    ) as string;

    await teachSenderStation(client, chargeId);

    revalidatePath("/revisao/cobrancas");
    revalidatePath("/pagamentos");
    revalidatePath("/energia");
    await revalidateSnapshot();
    return chargeId;
  });
}

/**
 * Teach-on-reclassify (feature B, decisão #38): if the cobrança carries an
 * email sender and now resolves to a station, learn the sender→station mapping
 * so the next boleto from that sender pre-matches. Best-effort — a teach
 * failure must never fail the approve/reclassify that triggered it.
 */
async function teachSenderStation(client: UserClient, chargeId: string): Promise<void> {
  try {
    const { data: after } = await client
      .from("charges")
      .select("email_sender, station_id")
      .eq("id", chargeId)
      .maybeSingle();
    const row = after as {
      email_sender: string | null;
      station_id: number | null;
    } | null;
    if (row?.email_sender && row.station_id !== null) {
      await client.rpc("set_station_sender", {
        p_sender_email: row.email_sender,
        p_station_id: row.station_id,
      });
    }
  } catch {
    /* teaching is best-effort */
  }
}

/** "Aprovar como está" — accept the current classification, clearing needs_review. */
export async function approveCobranca(
  chargeId: string,
  kind: ChargeKind,
): Promise<ActionResult<string>> {
  return reclassifyCharge({ chargeId, kind });
}

/**
 * Bulk approve for the Documentos de e-mail tab (#47): one JWT mint, then the
 * same reclassify_charge the per-row "Aprovar" uses (all patch params null →
 * approve-as-is), continuing past failures (precedent: resolveReceiptGroup,
 * decisão #43). Sender→station teaching runs per approved charge (#38).
 */
export async function approveCobrancas(
  items: { chargeId: string; kind: ChargeKind }[],
): Promise<ActionResult<{ approved: number; failed: number; firstError: string | null }>> {
  return withOperator(async (client) => {
    let approved = 0;
    let failed = 0;
    let firstError: string | null = null;
    for (const item of items) {
      try {
        unwrapRpc(
          await client.rpc("reclassify_charge", {
            p_charge_id: item.chargeId,
            p_kind: item.kind,
            p_competencia: null,
            p_amount: null,
            p_expected_amount: null,
            p_lines: null,
            p_cadastro_id: null,
            p_station_id: null,
            p_counterparty_name: null,
            p_counterparty_cnpj: null,
            p_payment_method: null,
            p_banco: null,
            p_agencia: null,
            p_conta: null,
            p_chave_pix: null,
            p_codigo_boleto: null,
            p_notes: null,
            p_due_date: null,
          }),
        );
        approved += 1;
        await teachSenderStation(client, item.chargeId);
      } catch (err) {
        failed += 1;
        // keep the FIRST RPC message — the pt-BR reason the human needs
        if (firstError === null) {
          firstError = err instanceof Error ? err.message : String(err);
        }
      }
    }
    // every charge failed → the whole action is an error (red toast with the
    // real RPC reason), not a green success reading "0 enviadas"
    if (approved === 0 && failed > 0) {
      throw new Error(firstError ?? "nenhuma cobrança pôde ser enviada");
    }
    revalidatePath("/revisao/cobrancas");
    revalidatePath("/pagamentos");
    revalidatePath("/energia");
    await revalidateSnapshot();
    return { approved, failed, firstError };
  });
}

/**
 * "Descartar" (#47): retires webhook-created staging rows via the set-based
 * discard_charges RPC (source='email_ai' only; skip-not-error). Returns how
 * many were actually discarded — the UI warns when it's less than requested
 * (row already resolved in another session).
 */
export async function discardCharges(input: {
  chargeIds: string[];
  reason: string;
}): Promise<ActionResult<number>> {
  return withOperator(async (client) => {
    const count = unwrapRpc(
      await client.rpc("discard_charges", {
        p_charge_ids: input.chargeIds,
        p_reason: input.reason,
      }),
    ) as number;
    revalidatePath("/revisao/cobrancas");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();
    return count;
  });
}

export interface MergeChargesInput {
  duplicateId: string;
  targetId: string;
  /** Which proposal tier fired — recorded in the audit detail. */
  reason: string;
}

/**
 * Unifica uma cobrança duplicada com a sobrevivente (Peça 2, spec 2026-07-11):
 * a duplicada doa instrumento de pagamento/documento/vencimento ao alvo e vira
 * `cancelada` (nunca deletada — trilha de auditoria + FKs RESTRICT).
 */
export async function mergeCharges(
  input: MergeChargesInput,
): Promise<ActionResult<null>> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("merge_charge_into", {
        p_duplicate_id: input.duplicateId,
        p_target_id: input.targetId,
        p_reason: input.reason,
      }),
    );
    revalidatePath("/revisao/cobrancas");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();
    return null;
  });
}
