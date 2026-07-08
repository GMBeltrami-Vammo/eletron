/**
 * POST /api/uploads/meter-photo — photo-first meter-reading capture (mobile).
 * Guards: same-origin → `@vammo.com` session → operator. Validates the image,
 * extracts EXIF (verification), re-encodes to strip EXIF (sharp), uploads to the
 * meter-photos Drive folder (NO public permission — served via the proxy), and
 * inserts a `documents` row. The reading itself is created afterwards by the
 * `createMeterReading` action referencing the returned `documentId`.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSessionEmail,
  isOperatorEmail,
  isSameOrigin,
  userClientFor,
} from "@/lib/http/guards";
import { driveFolderId, findByName, uploadFile } from "@/lib/drive/client";
import { buildMeterPhotoName, meterPhotoCollisionName } from "@/lib/drive/naming";
import { processMeterPhoto } from "@/lib/uploads/meter-photo";
import { sha256Hex, validateUpload } from "@/lib/uploads/validate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
}

interface StationRow {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
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
  const stationId = Number(form.get("stationId"));
  if (!Number.isInteger(stationId)) return json({ error: "stationId inválido" }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const v = validateUpload(
    { buffer, filename: file.name, claimedMime: file.type },
    "image",
  );
  if (!v.ok) return json({ error: v.error }, v.status);

  try {
    const admin = supabaseAdmin();
    const { data: stData } = await admin
      .from("stations")
      .select("address, latitude, longitude")
      .eq("id", stationId)
      .maybeSingle();
    if (!stData) return json({ error: "estação não encontrada" }, 404);
    const station = stData as StationRow;

    const processed = await processMeterPhoto({
      buffer,
      sniffedMime: v.sniffedMime,
      stationLat: station.latitude,
      stationLon: station.longitude,
    });
    const sha = sha256Hex(processed.buffer);

    const { data: existing } = await admin
      .from("documents")
      .select("id")
      .eq("content_hash", sha)
      .maybeSingle();
    if (existing) {
      return json(
        {
          documentId: (existing as { id: string }).id,
          deduplicated: true,
          exif: { takenAt: processed.exif.taken_at, gps: processed.exif.gps },
          warnings: processed.exif.warnings,
        },
        200,
      );
    }

    const folderId = driveFolderId("meter_photos");
    const base = buildMeterPhotoName(stationId, station.address, todayInSaoPaulo());
    let name = base;
    for (let n = 2; n <= 50; n += 1) {
      if (!(await findByName(folderId, name))) break;
      name = meterPhotoCollisionName(base, n);
    }
    const uploaded = await uploadFile({
      folderId,
      name,
      mimeType: "image/jpeg",
      buffer: processed.buffer,
    });

    const { data: docIns, error } = await admin
      .from("documents")
      .insert({
        kind: "foto_medidor",
        source: "app_upload",
        drive_file_id: uploaded.fileId,
        drive_folder_kind: "meter_photos",
        web_view_link: uploaded.webViewLink,
        original_filename: file.name,
        content_hash: sha,
        mime_type: "image/jpeg",
        byte_size: processed.buffer.length,
        exif: processed.exif,
        processing_status: "processed",
        uploaded_by_email: email,
      })
      .select("id")
      .single();
    if (error) return json({ error: `falha ao registrar a foto: ${error.message}` }, 500);

    return json(
      {
        documentId: (docIns as { id: string }).id,
        driveFileId: uploaded.fileId,
        exif: { takenAt: processed.exif.taken_at, gps: processed.exif.gps },
        warnings: processed.exif.warnings,
      },
      201,
    );
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "falha no upload da foto" },
      502,
    );
  }
}
