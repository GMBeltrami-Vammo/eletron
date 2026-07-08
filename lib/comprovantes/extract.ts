/**
 * PDF → per-page text via `unpdf` (D1: serverless pdf.js build, no worker files
 * / native deps). Whitespace is collapsed per line but line breaks are kept —
 * the débito-automático label regexes in parse.ts are line-anchored.
 *
 * Not marked `server-only`: it is a pure buffer→text transform with no secrets,
 * so it stays importable (real-PDF acceptance tests will exercise it once
 * Gabriel provides fixtures).
 */

import { extractText, getDocumentProxy } from "unpdf";

/** Thrown when a PDF is password-protected (pdf.js PasswordException). */
export class PdfEncryptedError extends Error {
  constructor(message = "PDF protegido por senha") {
    super(message);
    this.name = "PdfEncryptedError";
  }
}

export interface ExtractedPdf {
  pageCount: number;
  /** One entry per physical page, whitespace-normalized. */
  pages: string[];
}

/** Collapse runs of spaces/tabs but preserve newlines. */
function normalizePageText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trimEnd())
    .join("\n")
    .trim();
}

function isPasswordException(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name ?? "";
  const msg = (err as { message?: string }).message ?? "";
  return name === "PasswordException" || /password/i.test(msg);
}

/**
 * Extracts per-page text. Throws `PdfEncryptedError` for password-protected
 * PDFs so the pipeline can route them to `needs_review`.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  const data = new Uint8Array(buffer);
  try {
    const pdf = await getDocumentProxy(data);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return {
      pageCount: totalPages,
      pages: text.map((p) => normalizePageText(p ?? "")),
    };
  } catch (err) {
    if (isPasswordException(err)) throw new PdfEncryptedError();
    throw err;
  }
}

/** True when no page carried extractable text (scanned/image comprovante). */
export function hasNoExtractableText(pages: string[]): boolean {
  return pages.join("").trim() === "";
}

/**
 * Cheap page count (parses structure, not text) for the upload route's inline
 * vs. defer decision. Throws `PdfEncryptedError` for protected PDFs.
 */
export async function pdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    return pdf.numPages;
  } catch (err) {
    if (isPasswordException(err)) throw new PdfEncryptedError();
    throw err;
  }
}
