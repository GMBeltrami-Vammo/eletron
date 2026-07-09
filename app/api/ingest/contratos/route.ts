/**
 * POST /api/ingest/contratos — n8n contract-onboarding webhook (Q10).
 * Replaces n8n's old Google-Form prefill URL + Slack message: n8n keeps the
 * Drive watch + OCR + OpenAI extraction, then POSTs its AI output here with a
 * Bearer N8N_INGEST_SECRET. Middleware-exempt; this is the only guard.
 *
 * The extraction is STAGED as a `pending` contract_intake (lib/ingest/contratos)
 * — a human reviews/confirms it via /revisao/contratos, which is the only path
 * that creates a real contract (decision #8 trust boundary; the app runs no AI).
 *
 * Status codes: 200 ok; 400 bad payload; 401 unauthorized; 422 Drive-download /
 * validation failure (n8n retries); 500 unexpected. Idempotent: the document is
 * deduped by sha256 and the intake by drive_file_id, so a redelivery reuses both.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { downloadFile } from "@/lib/drive/client";
import { isAuthorizedIngest } from "@/lib/ingest/ingest-auth";
import {
  ContratoIngestError,
  ingestContratoPayload,
  parseContratoPayload,
} from "@/lib/ingest/contratos";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedIngest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo não é JSON" }, { status: 400 });
  }

  try {
    const payload = parseContratoPayload(body);
    const admin = supabaseAdmin();
    const stats = await ingestContratoPayload(admin, payload, downloadFile);
    return NextResponse.json({ ok: true, ...stats }, { status: 200 });
  } catch (err) {
    if (err instanceof ContratoIngestError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
