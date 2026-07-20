/**
 * POST/GET /api/cron/daily — the single Vercel Hobby daily cron (vercel.json).
 *
 * Phase 2.5 (sheets severed): the chain is metabase-sync → alerts-eval →
 * comprovantes sweep → fiscal-send (Enel/EDP). Sheet-sync is GONE — the scraper
 * sheet is no longer an ingestion source; Metabase is queried directly and
 * everything else arrives via the app (uploads + the n8n cobrança webhook). The
 * comprovante drive-poll is also gone (2026-07-10) — the sweep is now purely the
 * crash-recovery net for uploads whose chunk loop was interrupted. The fiscal
 * send (2026-07-18, decision #42-follow-up) writes the day's eligible Enel/EDP
 * faturas to the FISCAL sheet automatically — same rules as the manual "Enviar
 * ao fiscal em lote" button, which stays available for on-demand sends. Auth:
 * constant-time Bearer CRON_SECRET. Resilient: each step runs even if the
 * previous one failed.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAlertsEval } from "@/lib/sync/alerts-eval";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { runMetabaseSync } from "@/lib/sync/metabase-sync";
import { sweepComprovantes } from "@/lib/comprovantes/sweep";
import { runFiscalSendCron } from "@/lib/fiscal/send-fiscal-cron";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function step<T>(
  run: () => Promise<T>,
): Promise<T | { status: "error"; error: string }> {
  try {
    return await run();
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function failed(r: unknown): boolean {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as { status?: string }).status === "error"
  );
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();

  const metabase = await step(() =>
    runMetabaseSync({ admin, trigger: "cron:daily" }),
  );
  const alerts = await step(() => runAlertsEval({ admin, trigger: "cron:daily" }));
  const sweep = await step(() => sweepComprovantes(admin));
  const fiscalSend = await step(() => runFiscalSendCron(admin, "cron:daily"));

  const ok = !failed(metabase) && !failed(alerts) && !failed(sweep) && !failed(fiscalSend);
  return NextResponse.json(
    {
      ok,
      metabaseSync: metabase,
      alertsEval: alerts,
      comprovantesSweep: sweep,
      fiscalSendEnergy: fiscalSend,
    },
    { status: ok ? 200 : 500 },
  );
}

export const GET = handle;
export const POST = handle;
