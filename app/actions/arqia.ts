"use server";

/**
 * ARQIA write actions (Gabriel 2026-07-22): add mobile data bought this month
 * (create_arqia_data_purchase RPC) + trigger a sync on demand. Operator-gated
 * (withOperator); the sync runs as service-role (supabaseAdmin) since it writes
 * the arqia_* tables.
 */

import { revalidatePath } from "next/cache";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { getSessionEmail, isOperatorEmail, userClientFor } from "@/lib/http/guards";
import { runArqiaSyncCron } from "@/lib/arqia/sync-cron";
import { sendArqiaAlert, slackConfigured } from "@/lib/slack/send";

export async function createArqiaDataPurchase(input: {
  mb: number;
  note?: string | null;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    if (!(input.mb > 0)) throw new Error("informe os MB comprados (> 0)");
    unwrapRpc(
      await client.rpc("create_arqia_data_purchase", {
        p_mb: input.mb,
        p_note: input.note?.trim() || null,
      }),
    );
    revalidatePath("/arqia");
  });
}

/**
 * Testa o SLACK_BOT_TOKEN do app: manda uma DM de teste pelos MESMOS caminhos do
 * alerta (lib/slack/send → chat.postMessage) para os destinatários configurados
 * (ARQIA_ALERT_SLACK_USERS ou os 3 defaults). Sucesso = o token é válido e o bot
 * consegue mandar DM. Não toca na API Arqia. Operator-gated.
 */
export async function sendArqiaTestMessage(): Promise<{
  ok: boolean;
  error?: string;
  count?: number;
}> {
  try {
    const email = await getSessionEmail();
    if (!email) return { ok: false, error: "não autenticado" };
    const client = await userClientFor(email);
    if (!(await isOperatorEmail(client, email))) {
      return { ok: false, error: "sem permissão" };
    }
    if (!slackConfigured()) {
      return { ok: false, error: "SLACK_BOT_TOKEN não configurado no Vercel" };
    }
    const text =
      `🧪 Teste do bot Slack — Eletron / Arqia\n` +
      `Se você recebeu isto, o SLACK_BOT_TOKEN está correto e o bot consegue mandar DM.\n` +
      `(disparado por ${email})`;
    const r = await sendArqiaAlert(text);
    if (!r.ok) {
      return {
        ok: false,
        error:
          "o bot não entregou — token inválido, sem escopo chat:write, ou não pode enviar DM a esses usuários",
      };
    }
    return { ok: true, count: r.sentTo.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncArqiaNow(): Promise<ActionResult> {
  return withOperator(async () => {
    // "Atualizar" só atualiza os dados — NUNCA manda Slack (sendAlerts=false).
    await runArqiaSyncCron(supabaseAdmin(), "manual:arqia", false);
    revalidatePath("/arqia");
  });
}
