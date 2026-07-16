/**
 * POST /api/uploads/comprovante — payment-receipt (PDF) upload. Guards:
 * same-origin → `@vammo.com` session → operator. Validates, hash-dedupes,
 * uploads the whole PDF to the comprovantes Drive folder (NO public permission),
 * inserts a `documents` row, and RETURNS `{ documentId, pageCount }` — the app
 * no longer processes inline (that + n8n are gone). The client then loops
 * 10-page chunks against `/api/uploads/comprovante/chunk` with a progress bar
 * (Gabriel 2026-07-10). Encrypted PDFs are stored and routed to `needs_review`
 * with an alert (never silently dropped).
 *
 * The whole file passes through this function, so it is bound by Vercel's
 * ~4.5 MB request-body cap (identical on Pro — the accepted ceiling); the client
 * dropzone rejects larger files with a friendly message before the POST.
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
import { buildUploadDriveName } from "@/lib/drive/naming";
import { isEncryptedPdf, validateUpload } from "@/lib/uploads/validate";

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

  const buffer = Buffer.from(await file.arrayBuffer());
  const v = validateUpload(
    { buffer, filename: file.name, claimedMime: file.type },
    "pdf",
  );
  if (!v.ok) return json({ error: v.error }, v.status);

  try {
    const admin = supabaseAdmin();

    // hash-dedupe (byte-identical receipts under different names are common)
    const { data: dup } = await admin
      .from("documents")
      .select("id, processing_status")
      .eq("content_hash", v.sha256)
      .maybeSingle();
    if (dup) {
      const d = dup as { id: string; processing_status: string };
      return json({ documentId: d.id, deduplicated: true, status: d.processing_status }, 200);
    }

    const folderId = driveFolderId("comprovantes");
    const name = buildUploadDriveName(file.name, v.sha256);

    let encrypted = isEncryptedPdf(buffer);
    let pageCount: number | null = null;
    if (!encrypted) {
      try {
        pageCount = await pdfPageCount(buffer);
      } catch (err) {
        if (err instanceof PdfEncryptedError) encrypted = true;
        else pageCount = null;
      }
    }

    const uploaded = await uploadFile({
      folderId,
      name,
      mimeType: "application/pdf",
      buffer,
    });

    const { data: docIns, error } = await admin
      .from("documents")
      .insert({
        kind: "comprovante",
        source: "app_upload",
        drive_file_id: uploaded.fileId,
        drive_folder_kind: "comprovantes",
        web_view_link: uploaded.webViewLink,
        original_filename: file.name,
        content_hash: v.sha256,
        mime_type: "application/pdf",
        byte_size: buffer.length,
        page_count: pageCount,
        processing_status: encrypted ? "needs_review" : "pending",
        processing_error: encrypted ? "comprovante protegido por senha" : null,
        uploaded_by_email: email,
      })
      .select("id")
      .single();
    if (error) {
      // Concurrent upload of a byte-identical PDF lost the content_hash race
      // (the SELECT dedup above ran before the winner committed). The unique
      // constraint is the source of truth: return the winner's row as a normal
      // dedup + delete the Drive file this loser just uploaded (review #4).
      if ((error as { code?: string }).code === "23505") {
        await deleteFile(uploaded.fileId).catch(() => {});
        const { data: won } = await admin
          .from("documents")
          .select("id, processing_status")
          .eq("content_hash", v.sha256)
          .maybeSingle();
        if (won) {
          const w = won as { id: string; processing_status: string };
          return json({ documentId: w.id, deduplicated: true, status: w.processing_status }, 200);
        }
      }
      return json({ error: `falha ao registrar o comprovante: ${error.message}` }, 500);
    }
    const documentId = (docIns as { id: string }).id;

    if (encrypted) {
      await admin.from("alerts").upsert(
        {
          alert_type: "encrypted_comprovante",
          severity: "warning",
          dedupe_key: `encrypted_comprovante:${v.sha256}`,
          payload: { document_id: documentId },
          last_detected_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key" },
      );
      return json(
        { documentId, status: "needs_review", reason: "comprovante protegido por senha" },
        422,
      );
    }

    // Handoff: the client loops 10-page chunks against /chunk with a progress
    // bar. `pageCount` null (unreadable count) → the client can't chunk, so the
    // daily sweep processes it whole (rare — corrupt/edge PDFs).
    return json({ documentId, status: "pending", pageCount }, 201);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "falha no upload do comprovante" },
      502,
    );
  }
}
