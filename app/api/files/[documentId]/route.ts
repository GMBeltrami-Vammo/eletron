/**
 * GET /api/files/[documentId] — session-checked Drive stream proxy (decision
 * #17). Any `@vammo.com` session may read; the document row is looked up under
 * the user token (RLS), then the bytes are streamed from Drive via the service
 * account. Served inline with a short private cache; never a public link.
 */

import { downloadFile } from "@/lib/drive/client";
import { getSessionEmail, userClientFor } from "@/lib/http/guards";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface DocRow {
  drive_file_id: string;
  mime_type: string | null;
  original_filename: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const email = await getSessionEmail();
  if (!email) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }
  const { documentId } = await params;

  const userClient = await userClientFor(email);
  const { data, error } = await userClient
    .from("documents")
    .select("drive_file_id, mime_type, original_filename")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !data) {
    return Response.json({ error: "documento não encontrado" }, { status: 404 });
  }
  const doc = data as DocRow;

  try {
    const bytes = await downloadFile(doc.drive_file_id);
    const filename = (doc.original_filename ?? "documento").replace(/["\r\n]/g, "");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": doc.mime_type ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "falha ao obter o arquivo" },
      { status: 502 },
    );
  }
}
