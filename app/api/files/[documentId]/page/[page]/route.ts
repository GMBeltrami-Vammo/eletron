/**
 * GET /api/files/[documentId]/page/[page] — the isolated single page of a
 * comprovante as its own one-page PDF (feature C). The exact page a charge is
 * bound to opens reliably here (vs the fragile #page=N browser anchor).
 *
 * Lazy-cache: served from the Supabase Storage bucket `comprovante_pages` when
 * already isolated; otherwise the whole PDF is fetched from Drive (decision #17
 * store), page n is split out with pdf-lib, uploaded to Storage + recorded in
 * charging.document_pages, then served. Session-gated (any @vammo.com).
 */

import { downloadFile } from "@/lib/drive/client";
import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PageOutOfRange, splitPdfPage } from "@/lib/comprovantes/split";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BUCKET = "comprovante_pages";

function servePdf(bytes: Uint8Array, page: number): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="pagina-${page}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ documentId: string; page: string }> },
): Promise<Response> {
  const email = await getSessionEmail();
  if (!email) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { documentId, page } = await params;
  const pageNum = Number(page);
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    return Response.json({ error: "página inválida" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const storagePath = `${documentId}/${pageNum}.pdf`;

  // Cached in Storage?
  const { data: cached } = await admin
    .from("document_pages")
    .select("storage_path")
    .eq("document_id", documentId)
    .eq("page_number", pageNum)
    .maybeSingle();
  if (cached) {
    const dl = await admin.storage
      .from(BUCKET)
      .download((cached as { storage_path: string }).storage_path);
    if (dl.data) return servePdf(new Uint8Array(await dl.data.arrayBuffer()), pageNum);
    // blob missing — fall through and re-generate
  }

  // Fetch the whole PDF from Drive and split out the page.
  const { data: doc } = await admin
    .from("documents")
    .select("drive_file_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return Response.json({ error: "documento não encontrado" }, { status: 404 });

  let whole: Buffer;
  try {
    whole = await downloadFile((doc as { drive_file_id: string }).drive_file_id);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "falha ao obter o PDF" },
      { status: 502 },
    );
  }

  let pageBytes: Uint8Array;
  try {
    pageBytes = await splitPdfPage(new Uint8Array(whole), pageNum);
  } catch (err) {
    if (err instanceof PageOutOfRange) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    return Response.json(
      { error: "falha ao isolar a página (PDF inválido ou criptografado)" },
      { status: 422 },
    );
  }

  // Lazy-cache to Storage (best-effort — still serve the bytes on failure).
  try {
    await admin.storage.from(BUCKET).upload(storagePath, Buffer.from(pageBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
    await admin.from("document_pages").upsert(
      {
        document_id: documentId,
        page_number: pageNum,
        storage_path: storagePath,
        byte_size: pageBytes.byteLength,
      },
      { onConflict: "document_id,page_number" },
    );
  } catch {
    /* caching is best-effort */
  }

  return servePdf(pageBytes, pageNum);
}
