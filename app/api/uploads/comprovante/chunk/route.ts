/**
 * POST /api/uploads/comprovante/chunk — processes ONE 10-page range of an
 * already-uploaded comprovante document. The client (upload-card) loops chunks
 * (from=1,to=10 → 11,20 → …) so every request stays well under the Vercel
 * function limit while a progress bar advances (Gabriel 2026-07-10, replacing
 * the n8n processing + the 20-page inline cap). Guards: same-origin → @vammo.com
 * session → operator. Idempotent; a transient failure leaves the doc `pending`.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSessionEmail,
  isOperatorEmail,
  isSameOrigin,
  userClientFor,
} from "@/lib/http/guards";
import { processComprovanteChunk } from "@/lib/comprovantes/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

interface ChunkBody {
  documentId?: unknown;
  from?: unknown;
  to?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isSameOrigin(req)) return json({ error: "origem inválida" }, 403);
  const email = await getSessionEmail();
  if (!email) return json({ error: "não autenticado" }, 401);
  const userClient = await userClientFor(email);
  if (!(await isOperatorEmail(userClient, email))) {
    return json({ error: "permissão de operador necessária" }, 403);
  }

  let body: ChunkBody;
  try {
    body = (await req.json()) as ChunkBody;
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }

  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  const from = Number(body.from);
  const to = Number(body.to);
  if (!documentId || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return json({ error: "documentId, from e to (1-based, to ≥ from) são obrigatórios" }, 400);
  }

  const result = await processComprovanteChunk(documentId, from, to, supabaseAdmin());
  if (result.error) {
    // documento não encontrado / não é comprovante → 404; otherwise a transient
    // download/extract failure (doc left `pending`) → 502, client may retry the
    // same range. (Range is validated above, so 400 is handled before this.)
    return json(result, /não encontrado/.test(result.error) ? 404 : 502);
  }
  return json(result, 200);
}
