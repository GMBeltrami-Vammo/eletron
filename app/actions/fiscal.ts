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
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSheetsClient } from "@/lib/ingest/sheets-loader";
import { checkFaturasOnFiscal } from "@/lib/fiscal/check-faturas";

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
