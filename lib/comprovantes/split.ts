import { PDFDocument } from "pdf-lib";

/**
 * Feature C: extract a single page (1-based) from a PDF as its own one-page PDF.
 * Used by the /api/files/[documentId]/page/[n] route to isolate the exact page
 * a comprovante charge is bound to. Throws PageOutOfRange for a bad index and
 * lets pdf-lib's own errors surface for an unreadable PDF.
 */

export class PageOutOfRange extends Error {
  constructor(page: number, total: number) {
    super(`página ${page} fora do intervalo (documento tem ${total})`);
    this.name = "PageOutOfRange";
  }
}

export async function splitPdfPage(
  input: Uint8Array,
  pageNumber: number,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(input, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) {
    throw new PageOutOfRange(pageNumber, total);
  }
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [pageNumber - 1]);
  out.addPage(copied);
  return out.save();
}
