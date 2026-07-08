/**
 * GET/POST /api/cron/comprovantes-drive-poll — n8n-scheduled poll of the shared
 * comprovantes Drive folder (decision #22, drive-comprovantes §4.5). Auth:
 * constant-time Bearer CRON_SECRET (middleware-exempt). Job-leased via
 * `claim_job`. Steps: cursor read → list new files (2-min overlap for clock
 * skew) → skip already-ingested drive ids + hashed dupes → ingest + process →
 * sweep stale `pending` comprovantes → drain the sheet-writeback outbox →
 * advance the cursor. Idempotent (hash dedupe + upserted receipts); n8n keeps
 * writing the sheet Comprovante column in parallel — no shared writes.
 */

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ChargingClient } from "@/lib/data/supabase-repository";
import { isAuthorizedCron } from "@/lib/sync/cron-auth";
import { claimJob, finalizeJob } from "@/lib/sync/job-runs";
import { processComprovanteDocument } from "@/lib/comprovantes/pipeline";
import { pdfPageCount, PdfEncryptedError } from "@/lib/comprovantes/extract";
import { downloadFile, driveFolderId, listFolder } from "@/lib/drive/client";
import { processWritebackOutbox } from "@/lib/sheets/faturas-writeback";
import { isEncryptedPdf, validateUpload } from "@/lib/uploads/validate";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const JOB_NAME = "comprovantes-drive-poll";
const OVERLAP_MS = 2 * 60 * 1000;
const SWEEP_LIMIT = 50;

interface PollStats {
  filesSeen: number;
  ingested: number;
  processed: number;
  deduped: number;
  encrypted: number;
  failed: number;
  swept: number;
  writeback: { completed: number; failed: number; pending: number };
}

async function readCursor(admin: ChargingClient): Promise<string | null> {
  const { data } = await admin
    .from("sync_cursors")
    .select("cursor")
    .eq("job_name", JOB_NAME)
    .maybeSingle();
  return (data as { cursor: string | null } | null)?.cursor ?? null;
}

async function runPoll(admin: ChargingClient): Promise<PollStats> {
  const nowIso = new Date().toISOString();
  const folderId = driveFolderId("comprovantes");
  const cursorIso = await readCursor(admin);
  const modifiedAfter = cursorIso
    ? new Date(new Date(cursorIso).getTime() - OVERLAP_MS)
    : undefined;

  const files = await listFolder(folderId, {
    modifiedAfter,
    mimeType: "application/pdf",
  });

  const stats: PollStats = {
    filesSeen: files.length,
    ingested: 0,
    processed: 0,
    deduped: 0,
    encrypted: 0,
    failed: 0,
    swept: 0,
    writeback: { completed: 0, failed: 0, pending: 0 },
  };
  let maxModified = cursorIso ? new Date(cursorIso).getTime() : 0;

  // already-ingested drive ids → skip without downloading
  const known = new Set<string>();
  if (files.length > 0) {
    const { data: existRows } = await admin
      .from("documents")
      .select("drive_file_id")
      .in(
        "drive_file_id",
        files.map((f) => f.id),
      );
    for (const r of (existRows ?? []) as { drive_file_id: string }[]) {
      known.add(r.drive_file_id);
    }
  }

  for (const file of files) {
    const t = new Date(file.modifiedTime).getTime();
    if (Number.isFinite(t) && t > maxModified) maxModified = t;
    if (known.has(file.id)) continue;

    const buffer = await downloadFile(file.id);
    const v = validateUpload(
      { buffer, filename: file.name, claimedMime: "application/pdf" },
      "pdf",
    );
    if (!v.ok) continue; // non-PDF / oversize — leave for a human

    const { data: dupRow } = await admin
      .from("documents")
      .select("id")
      .eq("content_hash", v.sha256)
      .maybeSingle();
    if (dupRow) {
      stats.deduped += 1;
      continue;
    }

    let encrypted = isEncryptedPdf(buffer);
    let pageCount: number | null = null;
    if (!encrypted) {
      try {
        pageCount = await pdfPageCount(buffer);
      } catch (err) {
        if (err instanceof PdfEncryptedError) encrypted = true;
      }
    }

    const { data: docIns, error } = await admin
      .from("documents")
      .insert({
        kind: "comprovante",
        source: "drive_poll",
        drive_file_id: file.id,
        drive_folder_kind: "comprovantes",
        web_view_link: file.webViewLink ?? null,
        original_filename: file.name,
        content_hash: v.sha256,
        mime_type: "application/pdf",
        byte_size: buffer.length,
        page_count: pageCount,
        processing_status: encrypted ? "needs_review" : "pending",
        processing_error: encrypted ? "comprovante protegido por senha" : null,
      })
      .select("id")
      .single();
    if (error || !docIns) continue; // unique race — another run won it
    stats.ingested += 1;
    const documentId = (docIns as { id: string }).id;

    if (encrypted) {
      await admin
        .from("documents")
        .update({ processed_at: nowIso })
        .eq("id", documentId);
      await admin.from("alerts").upsert(
        {
          alert_type: "encrypted_comprovante",
          severity: "warning",
          dedupe_key: `encrypted_comprovante:${v.sha256}`,
          payload: { document_id: documentId },
          last_detected_at: nowIso,
        },
        { onConflict: "dedupe_key" },
      );
      stats.encrypted += 1;
    } else {
      const r = await processComprovanteDocument(documentId, admin);
      stats.processed += 1;
      if (r.status === "failed") stats.failed += 1;
    }
  }

  // sweep comprovantes left `pending` (upload deferral / crashed run)
  const twoMinAgo = new Date(Date.now() - OVERLAP_MS).toISOString();
  const { data: stale } = await admin
    .from("documents")
    .select("id")
    .eq("processing_status", "pending")
    .eq("kind", "comprovante")
    .lt("created_at", twoMinAgo)
    .limit(SWEEP_LIMIT);
  for (const row of (stale ?? []) as { id: string }[]) {
    const r = await processComprovanteDocument(row.id, admin);
    stats.swept += 1;
    if (r.status === "failed") stats.failed += 1;
  }

  // drain the manual-bill sheet-writeback outbox
  const wb = await processWritebackOutbox(admin);
  stats.writeback = { completed: wb.completed, failed: wb.failed, pending: wb.pending };

  // advance the cursor to the newest modifiedTime seen
  const newCursorIso = maxModified > 0 ? new Date(maxModified).toISOString() : cursorIso;
  if (newCursorIso) {
    await admin
      .from("sync_cursors")
      .upsert({ job_name: JOB_NAME, cursor: newCursorIso }, { onConflict: "job_name" });
  }

  return stats;
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = supabaseAdmin();
  const jobId = await claimJob(admin, JOB_NAME, 600);
  if (!jobId) {
    return NextResponse.json({ ok: true, status: "skipped_locked" }, { status: 200 });
  }
  try {
    const stats = await runPoll(admin);
    await finalizeJob(admin, jobId, { status: "success", trigger: "cron", stats });
    return NextResponse.json({ ok: true, status: "success", ...stats }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(admin, jobId, { status: "error", trigger: "cron", error: message }).catch(
      () => {
        /* best-effort */
      },
    );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
