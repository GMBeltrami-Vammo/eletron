"use server";

/**
 * Fiscal-sheet verification (decision #40) — the /energia "Verificar no fiscal"
 * button. Read-only: checks every Enel/EDP fatura against the FISCAL spreadsheet
 * (`FISCAL_SPREADSHEET_ID`, read by the clone SA `GSHEETS_SA_KEY_B64`) and
 * returns, per charge, whether it is already registered there. Never writes.
 * Session-gated (@vammo.com); the read uses the service role + the SA.
 */

import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSheetsClient } from "@/lib/ingest/sheets-loader";
import { checkFaturasOnFiscal } from "@/lib/fiscal/check-faturas";
import type { ActionResult } from "@/lib/http/actions";

interface FiscalVerifyResult {
  /** chargeId → fiscal-sheet status. */
  results: Record<string, { registered: boolean; tabExists: boolean }>;
  summary: {
    total: number;
    registered: number;
    notRegistered: number;
    noTab: number;
  };
  /** ISO timestamp of the check. */
  checkedAt: string;
}

export async function verifyFaturasOnFiscal(): Promise<
  ActionResult<FiscalVerifyResult>
> {
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "não autenticado" };

  const spreadsheetId = process.env.FISCAL_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return {
      ok: false,
      error:
        "FISCAL_SPREADSHEET_ID não configurado. Defina a variável no Vercel e conceda Viewer ao service account na planilha fiscal.",
    };
  }

  try {
    const report = await checkFaturasOnFiscal(
      supabaseAdmin(),
      createSheetsClient(),
      spreadsheetId,
    );
    const results: FiscalVerifyResult["results"] = {};
    for (const r of report.results) {
      results[r.chargeId] = { registered: r.registered, tabExists: r.tabExists };
    }
    return {
      ok: true,
      data: { results, summary: report.summary, checkedAt: new Date().toISOString() },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "falha ao verificar no fiscal",
    };
  }
}
