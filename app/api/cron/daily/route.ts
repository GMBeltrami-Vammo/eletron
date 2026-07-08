/**
 * POST/GET /api/cron/daily — the single Vercel Hobby daily cron (see
 * vercel.json). A resilient CATCH-UP that runs sheet-sync then alerts-eval in
 * one invocation (decision #22 / H6): the n8n schedulers do the 3×/day sync +
 * chained alerts during the day; this guarantees at least one full pass even if
 * n8n is down. Auth: constant-time Bearer CRON_SECRET.
 *
 * Resilient: alerts-eval still runs even if sheet-sync errors/locks, so the
 * panel reflects the freshest data available (and can raise sheet_sync_stale).
 */

import { NextResponse } from "next/server";

import { loadRawTabs } from "@/lib/ingest/load-raw";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAlertsEval } from "@/lib/sync/alerts-eval";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { runSheetSync } from "@/lib/sync/sheet-sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function step<T extends { status: string }>(
  run: () => Promise<T>,
): Promise<T | { status: "error"; error: string }> {
  try {
    return await run();
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();

  const sync = await step(async () => {
    const r = await runSheetSync({
      admin,
      loadRaw: loadRawTabs,
      trigger: "cron:daily",
    });
    // drop the (large) snapshot from the response
    const { snapshot: _snapshot, ...summary } = r;
    void _snapshot;
    return summary;
  });

  const alerts = await step(() =>
    runAlertsEval({ admin, trigger: "cron:daily" }),
  );

  const ok = sync.status !== "error" && alerts.status !== "error";
  return NextResponse.json({ ok, sheetSync: sync, alertsEval: alerts }, {
    status: ok ? 200 : 500,
  });
}

export const GET = handle;
export const POST = handle;
