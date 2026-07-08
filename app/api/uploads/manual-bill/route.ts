/**
 * POST /api/uploads/manual-bill — manually enter an energy bill (Enel/EDP):
 * PDF + { billingAccountId, value, dueDate, competencia?, nf?, notes? }. Thin
 * wrapper over `createManualBillFromUpload` (the same core the `createManualBill`
 * action uses). Guards: same-origin → `@vammo.com` session → operator.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSessionEmail,
  isOperatorEmail,
  isSameOrigin,
  userClientFor,
} from "@/lib/http/guards";
import { UploadError } from "@/lib/http/errors";
import { createManualBillFromUpload } from "@/lib/uploads/manual-bill";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isSameOrigin(req)) return json({ error: "origem inválida" }, 403);
  const email = await getSessionEmail();
  if (!email) return json({ error: "não autenticado" }, 401);
  const userClient = await userClientFor(email);
  if (!(await isOperatorEmail(userClient, email))) {
    return json({ error: "permissão de operador necessária" }, 403);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "arquivo ausente" }, 400);
  const billingAccountId = String(form.get("billingAccountId") ?? "");
  const value = String(form.get("value") ?? "");
  const dueDate = String(form.get("dueDate") ?? "");
  if (!billingAccountId || !value || !dueDate) {
    return json({ error: "billingAccountId, value e dueDate são obrigatórios" }, 400);
  }
  const competencia = form.get("competencia") ? String(form.get("competencia")) : null;
  const nf = form.get("nf") ? String(form.get("nf")) : null;
  const notes = form.get("notes") ? String(form.get("notes")) : null;

  try {
    const result = await createManualBillFromUpload({
      userClient,
      admin: supabaseAdmin(),
      email,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      billingAccountId,
      value,
      dueDate,
      competencia,
      nf,
      notes,
    });
    return json(result, 201);
  } catch (err) {
    if (err instanceof UploadError) return json({ error: err.message }, err.status);
    return json(
      { error: err instanceof Error ? err.message : "falha ao registrar a fatura" },
      500,
    );
  }
}
