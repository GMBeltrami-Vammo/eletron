/**
 * POST /api/ingest/scraper — the Vammo-Enel scraper feed (decision #34).
 * The scrapers dual-write: they keep their Google-Sheet append AND POST the
 * same row-dicts here (Bearer SCRAPER_INGEST_SECRET). Middleware-exempt; this
 * Bearer is the only guard. Un-freezes the scraper data #25 froze.
 *
 * The core (assemble → normalize → scoped station-preserving upsert) lives in
 * lib/ingest/scraper-feed.ts; this route only wires auth + status codes.
 *
 * Status codes: 200 ok (+ stats); 400 bad payload / provider; 401 unauthorized;
 * 500 unexpected. Idempotent: charges dedupe on `enel:{id}:{due}` / `edp:{uc}:{due}`
 * (decision #20), so a re-POST converges without duplicating.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAuthorizedScraperIngest } from "@/lib/ingest/ingest-auth";
import {
  ScraperIngestError,
  ingestScraperPayload,
  parseScraperPayload,
} from "@/lib/ingest/scraper-feed";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedScraperIngest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo não é JSON" }, { status: 400 });
  }

  try {
    const payload = parseScraperPayload(body);
    const stats = await ingestScraperPayload(supabaseAdmin(), payload);
    return NextResponse.json({ ok: true, ...stats }, { status: 200 });
  } catch (err) {
    if (err instanceof ScraperIngestError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
