import { PDFDocument } from "pdf-lib";

/**
 * Extract pages from a PDF as their own one-page PDFs.
 *
 * `isolatePages` loads the source PDF ONCE and copies each requested page from
 * that single load — the eager per-match isolation (pipeline.ts) can materialize
 * every matched page of a chunk without re-parsing the whole PDF per page.
 * `splitPdfPage` is the single-page convenience used by the lazy hover route.
 * Throws PageOutOfRange for a bad index; lets pdf-lib's own errors surface for
 * an unreadable PDF.
 */

export class PageOutOfRange extends Error {
  constructor(page: number, total: number) {
    super(`página ${page} fora do intervalo (documento tem ${total})`);
    this.name = "PageOutOfRange";
  }
}

/**
 * Returns a map of 1-based pageNumber → one-page PDF bytes, loading the source
 * document a single time. `pageNumbers` are deduped; order is irrelevant.
 */
export async function isolatePages(
  input: Uint8Array,
  pageNumbers: number[],
): Promise<Map<number, Uint8Array>> {
  const src = await PDFDocument.load(input, { ignoreEncryption: true });
  const total = src.getPageCount();
  const out = new Map<number, Uint8Array>();
  for (const pageNumber of new Set(pageNumbers)) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) {
      throw new PageOutOfRange(pageNumber, total);
    }
    const doc = await PDFDocument.create();
    const [copied] = await doc.copyPages(src, [pageNumber - 1]);
    doc.addPage(copied);
    out.set(pageNumber, await doc.save());
  }
  return out;
}

/** Single-page split (1-based). Convenience over isolatePages. */
export async function splitPdfPage(
  input: Uint8Array,
  pageNumber: number,
): Promise<Uint8Array> {
  const pages = await isolatePages(input, [pageNumber]);
  return pages.get(pageNumber) as Uint8Array;
}
