/**
 * Real-PDF acceptance gate for the comprovante parser (D1 risk: does unpdf's
 * text extraction feed the regexes the way n8n's pdf-parse did?).
 *
 * Fixtures are real comprovantes with PII → they live in the gitignored
 * context/comprovante-fixtures/ (same pattern as the xlsx fixtures). This suite
 * self-skips where those files are absent (CI / other machines), so it never
 * breaks the shared gate — it validates locally on Gabriel's machine.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { extractPdfText, hasNoExtractableText } from "./extract";
import { parseComprovantePages } from "./parse";

const DIR = join(process.cwd(), "context", "comprovante-fixtures");
const FIXTURES = {
  debitoAutomatico: "Comprovante DA - 01 à 03 - Julho.pdf",
  mixed: "Comprovantes - 01 à 16 - Junho (1).pdf",
};

const present = existsSync(DIR);
const suite = present ? describe : describe.skip;

suite("comprovante parser — real PDFs", () => {
  it("débito-automático PDF: extracts text and parses DA receipts", async () => {
    const buf = readFileSync(join(DIR, FIXTURES.debitoAutomatico));
    const { pages, pageCount } = await extractPdfText(buf);
    expect(pageCount).toBeGreaterThan(0);
    expect(hasNoExtractableText(pages)).toBe(false);

    const receipts = parseComprovantePages(pages);
    // eslint-disable-next-line no-console
    console.log(
      `[DA] pages=${pageCount} receipts=${receipts.length}`,
      receipts.map((r) => ({
        p: `${r.pageNumber}.${r.segmentIndex}`,
        type: r.receiptType,
        amount: r.amount,
        paidAt: r.paidAt,
        utility: r.utility,
        id: r.identificacao?.slice(0, 40),
      })),
    );
    expect(receipts.length).toBeGreaterThan(0);
    // every DA receipt should carry a parseable amount + date (the fields the matcher needs)
    for (const r of receipts) {
      expect(r.amount, `receipt ${r.pageNumber}.${r.segmentIndex} amount`).not.toBeNull();
      expect(r.paidAt, `receipt ${r.pageNumber}.${r.segmentIndex} date`).not.toBeNull();
    }
  });

  it("mixed PDF: extracts text and parses receipts with amounts", async () => {
    const buf = readFileSync(join(DIR, FIXTURES.mixed));
    const { pages, pageCount } = await extractPdfText(buf);
    expect(pageCount).toBeGreaterThan(0);
    expect(hasNoExtractableText(pages)).toBe(false);

    const receipts = parseComprovantePages(pages);
    const withAmount = receipts.filter((r) => r.amount !== null);
    // eslint-disable-next-line no-console
    console.log(
      `[mixed] pages=${pageCount} receipts=${receipts.length} withAmount=${withAmount.length}`,
      receipts.slice(0, 12).map((r) => ({
        p: `${r.pageNumber}.${r.segmentIndex}`,
        type: r.receiptType,
        amount: r.amount,
        paidAt: r.paidAt,
      })),
    );
    expect(receipts.length).toBeGreaterThan(0);
    // majority should have a parsed amount (some pages may be cover/summary sheets)
    expect(withAmount.length).toBeGreaterThan(receipts.length / 2);
  });
});
