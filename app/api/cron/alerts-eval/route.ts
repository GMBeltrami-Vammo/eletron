/**
 * POST/GET /api/cron/alerts-eval — recompute + persist the alert panel from the
 * charging snapshot. Scheduled by n8n (chained after each sheet-sync); also
 * invoked by the daily catch-up. Auth: constant-time Bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAlertsEval } from "@/lib/sync/alerts-eval";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await runAlertsEval({ admin: supabaseAdmin(), trigger: "cron" });
    return NextResponse.json({ ok: r.status === "success", ...r });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
