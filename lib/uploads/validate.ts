/**
 * Upload validation — size caps, MIME allowlist + extension + magic-byte sniff,
 * `/Encrypt` detection, sha256 (security-ops §5). Pure (node:crypto only, no
 * `server-only`) so it is unit-testable and reusable by every upload route.
 *
 * The content type is ALWAYS taken from the byte sniff, never the client.
 */

import { createHash } from "crypto";

export type UploadPolicy = "pdf" | "image";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "heim",
  "heis",
  "hevm",
  "hevs",
]);

export type ValidateOk = { ok: true; sniffedMime: string; sha256: string };
export type ValidateErr = {
  ok: false;
  status: 400 | 413 | 415 | 422;
  error: string;
};

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function startsWithBytes(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function isPdf(buf: Buffer): boolean {
  return startsWithBytes(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
}

function isJpeg(buf: Buffer): boolean {
  return startsWithBytes(buf, [0xff, 0xd8, 0xff]);
}

function isPng(buf: Buffer): boolean {
  return startsWithBytes(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** HEIC/HEIF: `ftyp` box at offset 4 with a HEIC-family brand. */
function isHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.toString("ascii", 4, 8) !== "ftyp") return false;
  const head = buf.toString("ascii", 8, 32).toLowerCase();
  for (const brand of HEIC_BRANDS) if (head.includes(brand)) return true;
  return false;
}

/**
 * Scans the head + tail for the `/Encrypt` marker. unpdf may also throw a
 * PasswordException at parse time — both paths route the document to review.
 */
export function isEncryptedPdf(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 2048).toString("latin1");
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1");
  return head.includes("/Encrypt") || tail.includes("/Encrypt");
}

/**
 * Validates one uploaded file against a policy. On success returns the sniffed
 * MIME + sha256; on failure a status + pt-BR message.
 */
export function validateUpload(
  input: { buffer: Buffer; filename: string; claimedMime: string },
  policy: UploadPolicy,
): ValidateOk | ValidateErr {
  const { buffer, filename } = input;
  if (!buffer || buffer.length === 0) {
    return { ok: false, status: 400, error: "arquivo vazio" };
  }
  const ext = extOf(filename);

  if (policy === "pdf") {
    if (buffer.length > MAX_PDF_BYTES) {
      return { ok: false, status: 413, error: "PDF acima do limite de 25 MB" };
    }
    if (ext !== "pdf") {
      return { ok: false, status: 415, error: "extensão inválida (esperado .pdf)" };
    }
    if (!isPdf(buffer)) {
      return { ok: false, status: 415, error: "conteúdo não é um PDF válido" };
    }
    return { ok: true, sniffedMime: "application/pdf", sha256: sha256Hex(buffer) };
  }

  // image
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, status: 413, error: "imagem acima do limite de 10 MB" };
  }
  if (!["jpg", "jpeg", "png", "heic"].includes(ext)) {
    return {
      ok: false,
      status: 415,
      error: "extensão inválida (esperado .jpg, .jpeg, .png ou .heic)",
    };
  }
  let sniffedMime: string | null = null;
  if (isJpeg(buffer)) sniffedMime = "image/jpeg";
  else if (isPng(buffer)) sniffedMime = "image/png";
  else if (isHeic(buffer)) sniffedMime = "image/heic";
  if (!sniffedMime) {
    return { ok: false, status: 415, error: "conteúdo não é uma imagem suportada" };
  }
  return { ok: true, sniffedMime, sha256: sha256Hex(buffer) };
}
