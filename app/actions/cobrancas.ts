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
import type { ChargeKind, PaymentMethod } from "@/lib/domain";

export interface ReclassifyInput {
  chargeId: string;
  kind: ChargeKind;
  /** 'YYYY-MM' or 'YYYY-MM-DD'; null = leave unchanged. */
  competencia?: string | null;
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
      }),
    ) as string;

    // Teach-on-reclassify (feature B): if this cobrança carries an email sender
    // and now resolves to a station, learn the sender→station mapping so the
    // next boleto from that sender pre-matches. Best-effort — a teach failure
    // must not fail the reclassify.
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

    revalidatePath("/revisao/cobrancas");
    revalidatePath("/pagamentos");
    revalidatePath("/energia");
    await revalidateSnapshot();
    return chargeId;
  });
}

/** "Aprovar como está" — accept the current classification, clearing needs_review. */
export async function approveCobranca(
  chargeId: string,
  kind: ChargeKind,
): Promise<ActionResult<string>> {
  return reclassifyCharge({ chargeId, kind });
}
