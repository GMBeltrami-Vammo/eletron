import "server-only";

/**
 * Daily automatic Enel/EDP fiscal send (Gabriel 2026-07-18): "check if the bill
 * is already on the fiscal sheet, if not (with the due-date rule) send it — at
 * least once a day, automatically." This is NOT a separate code path — it calls
 * the exact same `sendFaturasToFiscal` the human "Enviar ao fiscal em lote"
 * button uses (decision #42: same classify rules, same locale guard, same
 * per-row self-verify round-trip), just triggered from the daily cron instead
 * of a server action, and applying the result via the service-role client
 * (migration 20260718100050 taught the two write RPCs to accept service_role).
 *
 * Runs under a `job_runs` lease ('fiscal-send-energy') so two overlapping cron
 * firings can't double-send — mirrors alerts-eval/metabase-sync (lib/sync/).
 * The human button does NOT share this lease (accepted risk — see decisions.md):
 * `sendFaturasToFiscal` re-verifies the live sheet at the start of its own run,
 * so the only exposure is the rare case of the button being clicked in the same
 * instant the cron is mid-run.
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import { createSheetsWriteClient } from "@/lib/ingest/sheets-loader";
import { claimJob, finalizeJob } from "@/lib/sync/job-runs";
import { applyFiscalSendIds, sendFaturasToFiscal, type SendFiscalSummary } from "./send-fiscal";

export const FISCAL_SEND_ENERGY_JOB_NAME = "fiscal-send-energy";

export type FiscalSendCronResult =
  | { status: "unconfigured" }
  | { status: "skipped_locked" }
  | { status: "success"; jobId: string; summary: SendFiscalSummary };

/**
 * Runs the Enel/EDP fiscal send under a job lease. Throws (after finalizing the
 * job as errored) on failure — the caller (the cron route's `step()` wrapper)
 * converts that into the uniform `{status:'error', error}` shape.
 */
export async function runFiscalSendCron(
  admin: ChargingClient,
  trigger: string,
): Promise<FiscalSendCronResult> {
  const spreadsheetId = process.env.FISCAL_SPREADSHEET_ID;
  if (!spreadsheetId) {
    // Expected in dev/preview (no fiscal sheet configured) — not an error.
    return { status: "unconfigured" };
  }

  const jobId = await claimJob(admin, FISCAL_SEND_ENERGY_JOB_NAME);
  if (!jobId) {
    return { status: "skipped_locked" };
  }

  try {
    const summary = await sendFaturasToFiscal(
      admin,
      createSheetsWriteClient(),
      spreadsheetId,
      new Date(),
    );
    await applyFiscalSendIds(admin, summary);

    await finalizeJob(admin, jobId, {
      status: "success",
      trigger,
      stats: {
        sent: summary.sent,
        alreadyOnSheet: summary.alreadyOnSheet,
        zeroValue: summary.zeroValue,
        pastDue: summary.pastDue,
        ignoredPast: summary.ignoredPast,
        blockedFuture: summary.blockedFuture,
        semAba: summary.semAba,
        noValor: summary.noValor,
        verifyFailed: summary.verifyFailed,
        appendFailed: summary.appendFailed,
      },
    });
    return { status: "success", jobId, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(admin, jobId, { status: "error", trigger, error: message }).catch(() => {
      /* best-effort */
    });
    throw err;
  }
}
