/**
 * Pure-logic tests for payment-links (R1): the payments→receipts→documents
 * join, the row summary, and the deep-link builder.
 */

import { describe, expect, it } from "vitest";

import {
  comprovanteHref,
  indexPaymentLinks,
  summarizeLinks,
} from "./payment-links.shared";

const payments = [
  {
    id: "p1",
    charge_id: "c1",
    amount: 100,
    paid_at: "2026-07-01",
    receipt_id: "r1",
  },
  {
    id: "p2",
    charge_id: "c1",
    amount: 50,
    paid_at: null,
    receipt_id: null, // 'Pago' checkmark without receipt
  },
  {
    id: "p3",
    charge_id: "c2",
    amount: null,
    paid_at: "2026-07-02",
    receipt_id: "r2",
  },
];
const receipts = [
  { id: "r1", document_id: "doc1", page_number: 3 },
  { id: "r2", document_id: null, page_number: 1 }, // clone-era, document-less
];
const chargeKeys = [
  { id: "c1", dedupe_key: "enel:123:2026-07-10" },
  { id: "c2", dedupe_key: "pag:44:2026-07:aluguel" },
  { id: "c3", dedupe_key: "edp:9:2026-07-05" }, // no payments
];

describe("indexPaymentLinks", () => {
  const idx = indexPaymentLinks(payments, receipts, chargeKeys);

  it("groups payments per charge and resolves receipt→document", () => {
    const c1 = idx.byChargeUuid.get("c1");
    expect(c1).toHaveLength(2);
    expect(c1?.[0]).toMatchObject({ documentId: "doc1", page: 3 });
    expect(c1?.[1]).toMatchObject({ documentId: null, receiptId: null });
  });

  it("keys the same lists by dedupe_key (backend-agnostic join)", () => {
    expect(idx.byDedupeKey.get("enel:123:2026-07-10")).toBe(
      idx.byChargeUuid.get("c1"),
    );
    expect(idx.byDedupeKey.has("edp:9:2026-07-05")).toBe(false);
  });
});

describe("summarizeLinks", () => {
  const idx = indexPaymentLinks(payments, receipts, chargeKeys);

  it("sums amounts and picks the first documented link", () => {
    const s = summarizeLinks(idx.byChargeUuid.get("c1"));
    expect(s).toEqual({ count: 2, paidAmount: 150, documentId: "doc1", page: 3 });
  });

  it("null paidAmount when no payment carries an amount; no doc → null id", () => {
    const s = summarizeLinks(idx.byChargeUuid.get("c2"));
    expect(s).toEqual({ count: 1, paidAmount: null, documentId: null, page: null });
  });

  it("returns null for charges without payments", () => {
    expect(summarizeLinks(undefined)).toBeNull();
    expect(summarizeLinks([])).toBeNull();
  });
});

describe("comprovanteHref", () => {
  it("adds ?page= only past page 1; null without a document", () => {
    expect(
      comprovanteHref({ count: 1, paidAmount: 10, documentId: "d", page: 3 }),
    ).toBe("/comprovantes/d?page=3");
    expect(
      comprovanteHref({ count: 1, paidAmount: 10, documentId: "d", page: 1 }),
    ).toBe("/comprovantes/d");
    expect(
      comprovanteHref({ count: 1, paidAmount: 10, documentId: null, page: null }),
    ).toBeNull();
    expect(comprovanteHref(null)).toBeNull();
  });
});
