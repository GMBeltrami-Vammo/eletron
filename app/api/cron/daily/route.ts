/**
 * POST/GET /api/cron/daily — the single Vercel Hobby daily cron (vercel.json).
 *
 * Phase 2.5 (sheets severed): the chain is metabase-sync → alerts-eval →
 * comprovantes sweep. Sheet-sync is GONE — the scraper sheet is no longer an
 * ingestion source; Metabase is queried directly and everything else arrives
 * via the app (uploads, n8n webhook, Drive poll). Auth: constant-time Bearer
 * CRON_SECRET. Resilient: each step runs even if the previous one failed.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAlertsEval } from "@/lib/sync/alerts-eval";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { runMetabaseSync } from "@/lib/sync/metabase-sync";
import { sweepComprovantes } from "@/lib/comprovantes/sweep";

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

  const ok = !failed(metabase) && !failed(alerts) && !failed(sweep);
  return NextResponse.json(
    { ok, metabaseSync: metabase, alertsEval: alerts, comprovantesSweep: sweep },
    { status: ok ? 200 : 500 },
  );
}

export const GET = handle;
export const POST = handle;
