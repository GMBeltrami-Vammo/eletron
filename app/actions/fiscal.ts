"use server";

/**
 * Fiscal-sheet verification + sync (decision #40) — the /energia "Verificar no
 * fiscal" button. Reads every Enel/EDP fatura from `charging`, checks each
 * against the FISCAL spreadsheet (`FISCAL_SPREADSHEET_ID`, read by the clone SA
 * `GSHEETS_SA_KEY_B64`), then SYNCS `fiscal_exported` to what was found there:
 * registered → true (Ciclo 3 · Enviada ao fiscal), otherwise false. The sheet
 * itself is never written. This is how "Enviada ao fiscal" is EARNED after the
 * reset that cleared the untrusted cloned flags.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { getSessionEmail } from "@/lib/http/guards";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSheetsClient, createSheetsWriteClient } from "@/lib/ingest/sheets-loader";
import { checkFaturasOnFiscal, loadEnergyFaturas } from "@/lib/fiscal/check-faturas";
import { SENDABLE_YEAR } from "@/lib/fiscal/fiscal-row";
import {
  sendFaturasToFiscal,
  type SendFiscalSummary,
} from "@/lib/fiscal/send-fiscal";

interface FiscalVerifyResult {
  summary: {
    total: number;
    registered: number;
    notRegistered: number;
    noTab: number;
  };
  /** Faturas newly marked "Enviada ao fiscal" this run. */
  promoted: number;
  /** Faturas cleared of the flag this run (were flagged, now not on the sheet). */
  demoted: number;
  checkedAt: string;
}

export async function verifyFaturasOnFiscal(): Promise<
  ActionResult<FiscalVerifyResult>
> {
  return withOperator(async (client) => {
    const spreadsheetId = process.env.FISCAL_SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error(
        "FISCAL_SPREADSHEET_ID não configurado. Defina a variável no Vercel e conceda Viewer ao service account na planilha fiscal.",
      );
    }

    // READ: service role for charging, the clone SA for the fiscal sheet.
    const report = await checkFaturasOnFiscal(
      supabaseAdmin(),
      createSheetsClient(),
      spreadsheetId,
    );

    // WRITE: sync fiscal_exported to what the sheet says (via the audited RPC).
    const registeredIds = report.results
      .filter((r) => r.registered)
      .map((r) => r.chargeId);
    const notRegisteredIds = report.results
      .filter((r) => !r.registered)
      .map((r) => r.chargeId);

    const promoted = unwrapRpc(
      await client.rpc("set_fiscal_exported", {
        p_charge_ids: registeredIds,
        p_value: true,
      }),
    ) as number;
    const demoted = unwrapRpc(
      await client.rpc("set_fiscal_exported", {
        p_charge_ids: notRegisteredIds,
        p_value: false,
      }),
    ) as number;

    revalidatePath("/energia");
    revalidatePath("/mensal");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();

    return {
      summary: report.summary,
      promoted,
      demoted,
      checkedAt: new Date().toISOString(),
    };
  });
}

/**
 * Sends eligible energy faturas to the FISCAL sheet (decision #42): appends the
 * not-yet-registered, Cadastrado, 2026 faturas to their due-month tab and marks
 * them fiscal_exported=true (→ Ciclo 3). WRITES the sheet — needs the SA to have
 * Editor. Direct (no preview step, per Gabriel); the row format is
 * self-verified before each append.
 */
export async function sendToFiscal(): Promise<ActionResult<SendFiscalSummary>> {
  return withOperator(async (client) => {
    const spreadsheetId = process.env.FISCAL_SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error(
        "FISCAL_SPREADSHEET_ID não configurado. Defina no Vercel e conceda Editor ao service account na planilha fiscal.",
      );
    }

    const summary = await sendFaturasToFiscal(
      supabaseAdmin(),
      createSheetsWriteClient(),
      spreadsheetId,
      new Date(),
    );

    // "Verificar no fiscal" sync (run as part of the send): everything on the
    // sheet (registered + just sent) → checked; everything not on the sheet →
    // unchecked. Then settle the value-0 faturas (paid + auto-checked).
    if (summary.fiscalTrueIds.length > 0) {
      unwrapRpc(
        await client.rpc("set_fiscal_exported", {
          p_charge_ids: summary.fiscalTrueIds,
          p_value: true,
        }),
      );
    }
    if (summary.fiscalFalseIds.length > 0) {
      unwrapRpc(
        await client.rpc("set_fiscal_exported", {
          p_charge_ids: summary.fiscalFalseIds,
          p_value: false,
        }),
      );
    }
    if (summary.zeroValueIds.length > 0) {
      unwrapRpc(
        await client.rpc("settle_zero_value_faturas", {
          p_charge_ids: summary.zeroValueIds,
        }),
      );
    }

    revalidatePath("/energia");
    revalidatePath("/mensal");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();

    return summary;
  });
}

export interface ManualFaturaRow {
  chargeId: string;
  provider: "enel" | "edp";
  installationId: string;
  dueDate: string;
  amount: number | null;
  nf: string | null;
  /** Débito-automático registration number — needed to handle these by hand. */
  autoDebitRegistration: string | null;
  driveUrl: string | null;
}

interface FiscalManualQueue {
  /** Faturas the auto-send skips (2026, sem débito automático, ainda sem check). */
  faturas: ManualFaturaRow[];
}

/**
 * The manual-handling queue (decision #42): energy faturas the auto-send does
 * NOT touch — 2026, auto-debit ≠ Cadastrado, not yet marked "Enviado ao
 * fiscal" — so a human can check/add them in the fiscal sheet by hand.
 */
export async function getFiscalManualQueue(): Promise<
  ActionResult<FiscalManualQueue>
> {
  // Read-only (service role) — a session gate is enough; no JWT mint needed.
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "não autenticado" };
  try {
    // The FISCAL sheet URL/id is deliberately NOT surfaced to the UI (Gabriel):
    // the sheet must not be clickable/redirectable from the app.
    const all = await loadEnergyFaturas(supabaseAdmin());
    const faturas = all
      .filter(
        (f) =>
          Number(f.dueDate.slice(0, 4)) === SENDABLE_YEAR &&
          f.autoDebit !== "cadastrado" &&
          !f.fiscalExported,
      )
      .map((f) => ({
        chargeId: f.chargeId,
        provider: f.provider,
        installationId: f.installationId,
        dueDate: f.dueDate,
        amount: f.amount,
        nf: f.nf,
        autoDebitRegistration: f.autoDebitRegistration,
        driveUrl: f.driveUrl,
      }))
      .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
    return { ok: true, data: { faturas } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "falha ao carregar a fila",
    };
  }
}

/**
 * Marks faturas "Enviado ao fiscal" by hand (→ Ciclo 3) — used after adding
 * them to the fiscal sheet manually, so they leave the manual queue.
 */
export async function markFaturasFiscalExported(
  chargeIds: string[],
): Promise<ActionResult<number>> {
  return withOperator(async (client) => {
    if (chargeIds.length === 0) return 0;
    const changed = unwrapRpc(
      await client.rpc("set_fiscal_exported", {
        p_charge_ids: chargeIds,
        p_value: true,
      }),
    ) as number;
    revalidatePath("/energia");
    revalidatePath("/mensal");
    await revalidateSnapshot();
    return changed;
  });
}
