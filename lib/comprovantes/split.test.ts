import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { isolatePages, PageOutOfRange, splitPdfPage } from "./split";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("splitPdfPage", () => {
  it("extracts a single page as a valid one-page PDF", async () => {
    const src = await makePdf(3);
    const out = await splitPdfPage(src, 2);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
    // a real PDF byte stream
    expect(Buffer.from(out.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("accepts the first and last page", async () => {
    const src = await makePdf(2);
    expect((await PDFDocument.load(await splitPdfPage(src, 1))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await splitPdfPage(src, 2))).getPageCount()).toBe(1);
  });

  it("throws PageOutOfRange for an index past the end or below 1", async () => {
    const src = await makePdf(2);
    await expect(splitPdfPage(src, 3)).rejects.toBeInstanceOf(PageOutOfRange);
    await expect(splitPdfPage(src, 0)).rejects.toBeInstanceOf(PageOutOfRange);
  });
});

describe("isolatePages", () => {
  it("isolates several pages from a single load, keyed by page number", async () => {
    const src = await makePdf(5);
    const out = await isolatePages(src, [1, 3, 5]);
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([1, 3, 5]);
    for (const bytes of out.values()) {
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    }
  });

  it("dedupes repeated page numbers", async () => {
    const out = await isolatePages(await makePdf(3), [2, 2, 2]);
    expect(out.size).toBe(1);
    expect(out.has(2)).toBe(true);
  });

  it("throws PageOutOfRange when any requested page is out of range", async () => {
    await expect(isolatePages(await makePdf(2), [1, 5])).rejects.toBeInstanceOf(
      PageOutOfRange,
    );
  });
});
