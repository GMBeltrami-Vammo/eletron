import "server-only";

/**
 * Thin Drive v3 wrapper for the Phase 2 file store (decision #17). Every call
 * passes `supportsAllDrives: true` (+ `includeItemsFromAllDrives` on list) so
 * it works whether the folders live in My Drive or a Shared Drive.
 *
 * Permission policy (hard rule): `shareAnyoneReader` is set ONLY for manual-bill
 * PDFs (scraper-ecosystem parity — the sheet `=HYPERLINK` must open without a
 * Drive grant, exactly like gsheets.py `upload_pdf_to_drive`). Meter photos and
 * comprovantes get NO permission call; the app serves them via the
 * session-checked proxy `GET /api/files/[documentId]`.
 */

import { Readable } from "stream";

import type { DriveFolderKind } from "@/lib/domain";
import { getDriveClient } from "@/lib/google/clients";

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime: string;
  webViewLink?: string;
  md5Checksum?: string;
}

const LIST_FIELDS =
  "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, md5Checksum)";

/** Resolves a Drive folder id from its kind via the configured env var. */
export function driveFolderId(kind: DriveFolderKind): string {
  const envByKind: Record<DriveFolderKind, string> = {
    meter_photos: "DRIVE_METER_PHOTOS_FOLDER_ID",
    comprovantes: "DRIVE_COMPROVANTES_FOLDER_ID",
    bills: "DRIVE_BILLS_FOLDER_ID",
    other: "",
  };
  const envName = envByKind[kind];
  const id = envName ? process.env[envName] : undefined;
  if (!id) throw new Error(`Drive folder id not configured for kind '${kind}' (${envName})`);
  return id;
}

function toMeta(f: {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  md5Checksum?: string | null;
}): DriveFileMeta {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    size: f.size ? Number(f.size) : undefined,
    modifiedTime: f.modifiedTime ?? "",
    webViewLink: f.webViewLink ?? undefined,
    md5Checksum: f.md5Checksum ?? undefined,
  };
}

/**
 * Uploads a file to a Drive folder. When `shareAnyoneReader` is true, sets
 * `anyone → reader` (non-fatal on failure — the private link is still returned).
 */
export async function uploadFile(opts: {
  folderId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
  shareAnyoneReader?: boolean;
}): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.folderId] },
    media: { mimeType: opts.mimeType, body: Readable.from(opts.buffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = res.data.id;
  if (!fileId) throw new Error("Drive upload returned no file id");

  if (opts.shareAnyoneReader) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    } catch {
      // non-fatal: private link still works for authenticated viewers
    }
  }
  return { fileId, webViewLink: res.data.webViewLink ?? "" };
}

/** Downloads a Drive file's raw bytes. */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Lists a folder's files (paginated), optionally filtered by mime/modifiedTime. */
export async function listFolder(
  folderId: string,
  opts?: { modifiedAfter?: Date; mimeType?: string },
): Promise<DriveFileMeta[]> {
  const drive = getDriveClient();
  const clauses = [`'${folderId}' in parents`, "trashed = false"];
  if (opts?.mimeType) clauses.push(`mimeType = '${opts.mimeType}'`);
  if (opts?.modifiedAfter) clauses.push(`modifiedTime > '${opts.modifiedAfter.toISOString()}'`);
  const q = clauses.join(" and ");

  const out: DriveFileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q,
      orderBy: "modifiedTime",
      pageSize: 100,
      fields: LIST_FIELDS,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    for (const f of res.data.files ?? []) out.push(toMeta(f));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** Finds a file by EXACT name inside a folder (idempotency check before upload). */
export async function findByName(
  folderId: string,
  name: string,
): Promise<DriveFileMeta | null> {
  const drive = getDriveClient();
  const safe = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${safe}' and trashed = false`,
    fields: LIST_FIELDS,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res.data.files ?? [];
  return files.length > 0 ? toMeta(files[0]) : null;
}
