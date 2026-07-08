/**
 * POST/GET /api/cron/sheet-sync — full sheet → charging sync. Scheduled by n8n
 * (04:30 / 08:00 / 13:00 BRT); also invoked by the daily catch-up.
 * Auth: constant-time Bearer CRON_SECRET (this route is middleware-exempt).
 */

import { NextResponse } from "next/server";

import { loadRawTabs } from "@/lib/ingest/load-raw";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { runSheetSync } from "@/lib/sync/sheet-sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await runSheetSync({
      admin: supabaseAdmin(),
      loadRaw: loadRawTabs,
      trigger: "cron",
    });
    return NextResponse.json({
      ok: r.status === "success",
      status: r.status,
      jobId: r.jobId,
      counts: r.counts,
      rowsRead: r.rowsRead,
      rowsUpserted: r.rowsUpserted,
      rowsSkipped: r.rowsSkipped,
      maxScrapedAt: r.maxScrapedAt,
      fiscalExportedTrue: r.fiscalExportedTrue,
      referentialFixes: r.referentialFixes,
      issues: r.issues.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
