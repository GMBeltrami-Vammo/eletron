/**
 * POST /api/uploads/contrato — "Novo contrato" drop-PDF entry (decisão #48).
 * Guards: same-origin → `@vammo.com` session → operator. Validates, hash-
 * dedupes a `documents` row, uploads the whole PDF to the Contratos_Aluguel
 * Drive folder (the one n8n's Fill_Cadastro_Form trigger watches), and
 * PRE-CREATES a `contract_intake` row in `awaiting_extraction`. n8n then fires
 * on the Drive upload, extracts, and POSTs to /api/ingest/contratos, which
 * matches this same document (content_hash) + intake (document_id) and flips it
 * → `pending`. Returns `{ intakeId, documentId, pageCount }`; the /alugueis/novo
 * page polls the intake until the extraction arrives.
 *
 * Bound by Vercel's ~4.5 MB request-body cap (a contract PDF is small); the
 * client dropzone rejects larger files before the POST.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSessionEmail,
  isOperatorEmail,
  isSameOrigin,
  userClientFor,
} from "@/lib/http/guards";
import { pdfPageCount, PdfEncryptedError } from "@/lib/comprovantes/extract";
import { deleteFile, driveFolderId, uploadFile } from "@/lib/drive/client";
import { sanitizeDriveName } from "@/lib/drive/naming";
import { validateUpload } from "@/lib/uploads/validate";
import { DOCUMENT_KIND } from "@/lib/domain";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Finds the intake already staged for a document (idempotent re-drop / n8n-first race). */
async function existingIntakeFor(
  admin: ReturnType<typeof supabaseAdmin>,
  documentId: string,
): Promise<{ id: string; status: string } | null> {
  const { data } = await admin
    .from("contract_intake")
    .select("id, status")
    .eq("document_id", documentId)
    .maybeSingle();
  return (data as { id: string; status: string } | null) ?? null;
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const v = validateUpload(
    { buffer, filename: file.name, claimedMime: file.type },
    "pdf",
  );
  if (!v.ok) return json({ error: v.error }, v.status);

  try {
    const admin = supabaseAdmin();

    // The document may already exist (same PDF re-dropped, or n8n already
    // ingested it). Reuse it + its intake rather than duplicating.
    const { data: dup } = await admin
      .from("documents")
      .select("id")
      .eq("content_hash", v.sha256)
      .maybeSingle();
    if (dup) {
      const documentId = (dup as { id: string }).id;
      const intake = await existingIntakeFor(admin, documentId);
      if (intake) {
        return json(
          { intakeId: intake.id, documentId, status: intake.status, deduplicated: true },
          200,
        );
      }
      // document exists but no intake yet — stage one against it
      const intakeId = await stageIntake(admin, documentId, null, file.name);
      return json({ intakeId, documentId, status: "awaiting_extraction", deduplicated: true }, 200);
    }

    let pageCount: number | null = null;
    try {
      pageCount = await pdfPageCount(buffer);
    } catch (err) {
      if (!(err instanceof PdfEncryptedError)) pageCount = null;
    }

    const folderId = driveFolderId("contratos");
    const name = `${v.sha256.slice(0, 8)}_${sanitizeDriveName(file.name)}`;
    const uploaded = await uploadFile({
      folderId,
      name,
      mimeType: "application/pdf",
      buffer,
    });

    const { data: docIns, error } = await admin
      .from("documents")
      .insert({
        kind: DOCUMENT_KIND.contrato,
        source: "app_upload",
        drive_file_id: uploaded.fileId,
        drive_folder_kind: "other", // DB enum has no 'contratos' (#48)
        web_view_link: uploaded.webViewLink,
        original_filename: file.name,
        content_hash: v.sha256,
        mime_type: "application/pdf",
        byte_size: buffer.length,
        page_count: pageCount,
        processing_status: "processed",
        uploaded_by_email: email,
      })
      .select("id")
      .single();
    if (error) {
      // lost the content_hash race — delete this loser's Drive file, reuse the
      // winner's document + its (possibly already-staged) intake.
      if ((error as { code?: string }).code === "23505") {
        await deleteFile(uploaded.fileId).catch(() => {});
        const { data: won } = await admin
          .from("documents")
          .select("id")
          .eq("content_hash", v.sha256)
          .maybeSingle();
        if (won) {
          const documentId = (won as { id: string }).id;
          const intake =
            (await existingIntakeFor(admin, documentId)) ??
            ({ id: await stageIntake(admin, documentId, null, file.name), status: "awaiting_extraction" } as const);
          return json(
            { intakeId: intake.id, documentId, status: intake.status, deduplicated: true },
            200,
          );
        }
      }
      return json({ error: `falha ao registrar o contrato: ${error.message}` }, 500);
    }
    const documentId = (docIns as { id: string }).id;
    const intakeId = await stageIntake(admin, documentId, uploaded.fileId, file.name, uploaded.webViewLink);

    return json({ intakeId, documentId, status: "awaiting_extraction", pageCount }, 201);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "falha no upload do contrato" },
      502,
    );
  }
}

/**
 * Stages an `awaiting_extraction` intake for a freshly-uploaded contract, unless
 * one already exists for the document (idempotent). Returns the intake id.
 */
async function stageIntake(
  admin: ReturnType<typeof supabaseAdmin>,
  documentId: string,
  driveFileId: string | null,
  nomeArquivo: string,
  webViewLink: string | null = null,
): Promise<string> {
  const existing = await existingIntakeFor(admin, documentId);
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("contract_intake")
    .insert({
      document_id: documentId,
      drive_file_id: driveFileId,
      web_view_link: webViewLink,
      nome_arquivo: nomeArquivo,
      ai_extraction: {}, // filled by the n8n POST; awaiting until then
      status: "awaiting_extraction",
    })
    .select("id")
    .single();
  if (error) {
    // a concurrent stage (double-submit / n8n-first) won the document_id — reuse it
    const won = await existingIntakeFor(admin, documentId);
    if (won) return won.id;
    throw new Error(`contract_intake stage: ${error.message}`);
  }
  return (data as { id: string }).id;
}
