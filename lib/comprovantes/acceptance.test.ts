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

import type { ParsedReceipt } from "./types";
import { extractPdfText, hasNoExtractableText } from "./extract";
import { parseComprovantePages } from "./parse";

const DIR = join(process.cwd(), "context", "comprovante-fixtures");
const FIXTURES = {
  debitoAutomatico: "Comprovante DA - 01 à 03 - Julho.pdf",
  mixed: "Comprovantes - 01 à 16 - Junho (1).pdf",
};

/**
 * Bundle comprovantes that may contain Format-C ("Comprovante de Operação -
 * Concessionárias / 0048 - ELETROPAULO") pages — the format the in-app parser
 * previously fell through to the PIX/TED branch (amount=null).
 */
const FORMAT_C_CANDIDATES = [
  "Comprovantes - 01 à 16 - Junho (1).pdf",
  "Comprovantes - 17 à 24 Junho (1).pdf",
  "Comprovante - 07.07.pdf",
  "Comprovante - 07.07 pt 2.pdf",
  "Comprovante - 07.07 pt 3.pdf",
  "Comprovante - 07.07 pt 4.pdf",
  "Comprovante - 07.07 pt 5.pdf",
  "Comprovante - 07.07 pt 6.pdf",
];

const present = existsSync(DIR);
const suite = present ? describe : describe.skip;

async function parseFixture(name: string): Promise<ParsedReceipt[]> {
  const buf = readFileSync(join(DIR, name));
  const { pages } = await extractPdfText(buf);
  return parseComprovantePages(pages);
}

suite("comprovante parser — real PDFs", () => {
  it("débito-automático PDF: extracts text and parses DA receipts", async () => {
    const buf = readFileSync(join(DIR, FIXTURES.debitoAutomatico));
    const { pages, pageCount } = await extractPdfText(buf);
    expect(pageCount).toBeGreaterThan(0);
    expect(hasNoExtractableText(pages)).toBe(false);

    const receipts = parseComprovantePages(pages);
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

  it("Format C (concessionária / ELETROPAULO): every recognized receipt has an amount + barcode", async () => {
    let formatCTotal = 0;
    let fixturesWithFormatC = 0;
    const perType: Record<string, number> = {};

    for (const name of FORMAT_C_CANDIDATES) {
      if (!existsSync(join(DIR, name))) continue;
      const receipts = await parseFixture(name);
      const formatC = receipts.filter((r) => r.receiptType === "boleto_barcode");
      for (const r of receipts) perType[r.receiptType] = (perType[r.receiptType] ?? 0) + 1;
      if (formatC.length > 0) fixturesWithFormatC += 1;
      formatCTotal += formatC.length;

      console.log(
        `[format-c] ${name}: receipts=${receipts.length} formatC=${formatC.length}`,
        formatC.slice(0, 6).map((r) => ({
          p: `${r.pageNumber}.${r.segmentIndex}`,
          amount: r.amount,
          paidAt: r.paidAt,
          barcodeLen: r.codigoBarras?.length ?? 0,
          ctrl: r.ctrl,
        })),
      );

      // Every Format-C receipt the parser now recognizes must carry the fields
      // the matcher links on — a non-null amount AND a barcode. This is the
      // regression this change fixes (these pages used to yield amount=null).
      for (const r of formatC) {
        expect(
          r.amount,
          `${name} receipt ${r.pageNumber}.${r.segmentIndex} amount`,
        ).not.toBeNull();
        expect(
          r.codigoBarras,
          `${name} receipt ${r.pageNumber}.${r.segmentIndex} barcode`,
        ).not.toBeNull();
        expect(r.utility).toBe("enel");
      }
    }

    console.log(
      `[format-c] TOTAL formatC receipts=${formatCTotal} across ${fixturesWithFormatC} fixture(s); per-type across candidates=`,
      perType,
    );

    // The fixtures Gabriel supplied are expected to contain ≥1 Format-C page;
    // if this ever hits 0, the header regex or the extraction stopped matching.
    expect(formatCTotal).toBeGreaterThan(0);
  });
});
