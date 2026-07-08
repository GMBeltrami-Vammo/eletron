/**
 * POST /api/ingest/cobrancas — n8n email-cobrança webhook (decision #27, R2).
 * Replaces n8n's old `2_Pagamentos` sheet append: n8n keeps Gmail + LlamaParse
 * + AI + Drive upload, then POSTs its AI output here with a Bearer
 * N8N_INGEST_SECRET. Middleware-exempt; this is the only guard.
 *
 * Everything the webhook creates/touches lands `needs_review` (requirement
 * 4.1) so a human checks/reclassifies it via /revisao/cobrancas. The core
 * (parse → normalize → dedupe-converge) lives in lib/ingest/cobrancas.ts; this
 * route only wires auth + the Drive download + status codes.
 *
 * Status codes: 200 ok (incl. NOT_A_BILL short-circuit); 400 bad payload; 401
 * unauthorized; 422 Drive-download / validation failure (n8n retries); 500
 * unexpected. Idempotent: the document is deduped by sha256, so a redelivery
 * reuses it and re-converges without duplicating charges.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { downloadFile } from "@/lib/drive/client";
import { isAuthorizedIngest } from "@/lib/ingest/ingest-auth";
import {
  CobrancasIngestError,
  ingestCobrancasPayload,
  parsePayload,
} from "@/lib/ingest/cobrancas";

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
    const payload = parsePayload(body);
    const admin = supabaseAdmin();
    const stats = await ingestCobrancasPayload(admin, payload, downloadFile);
    return NextResponse.json({ ok: true, ...stats }, { status: 200 });
  } catch (err) {
    if (err instanceof CobrancasIngestError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
