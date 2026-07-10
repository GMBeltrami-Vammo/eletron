import { describe, expect, it } from "vitest";

import { buildResolvableGroups } from "./resolve-groups";
import type { ReviewCandidate, ReviewReceiptRow } from "./types";

function candidate(id: string): ReviewCandidate {
  return {
    id,
    kind: "aluguel",
    competencia: "2026-05-01",
    amount: 1200,
    stationId: 100,
    stationName: "Estação X",
  };
}

function row(overrides: Partial<ReviewReceiptRow>): ReviewReceiptRow {
  return {
    id: "r-0",
    documentId: "doc-1",
    filename: null,
    createdAt: null,
    uploadedByEmail: null,
    pageNumber: 1,
    segmentIndex: 0,
    receiptType: "pix",
    amount: 1200,
    paidAt: "2026-06-05",
    chavePix: null,
    cnpjCpf: null,
    agencia: null,
    conta: null,
    identificacao: null,
    codigoBarras: null,
    matchStatus: "needs_review",
    matchNotes: null,
    rawText: null,
    candidateIds: [],
    candidates: [],
    ...overrides,
  };
}

describe("buildResolvableGroups", () => {
  it("groups a symmetric 2↔2 set into one resolvable group with 2 pairs", () => {
    const cands = [candidate("c1"), candidate("c2")];
    const rows = [
      row({ id: "rA", candidateIds: ["c1", "c2"], candidates: cands }),
      row({ id: "rB", candidateIds: ["c2", "c1"], candidates: cands }), // order-independent
    ];
    const groups = buildResolvableGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].pairs).toHaveLength(2);
    // each receipt bound to a distinct charge (bijection)
    const chargeIds = groups[0].pairs.map((p) => p.chargeId).sort();
    const receiptIds = groups[0].pairs.map((p) => p.receiptId).sort();
    expect(chargeIds).toEqual(["c1", "c2"]);
    expect(receiptIds).toEqual(["rA", "rB"]);
    expect(groups[0].pairs.every((p) => p.amount === 1200)).toBe(true);
    expect(groups[0].pairs.every((p) => p.method === "pix")).toBe(true);
  });

  it("does NOT resolve an asymmetric 1↔2 (one receipt, two candidates)", () => {
    const rows = [row({ id: "rA", candidateIds: ["c1", "c2"], candidates: [] })];
    expect(buildResolvableGroups(rows)).toHaveLength(0);
  });

  it("does NOT resolve an asymmetric 3↔2 (three receipts, two candidates)", () => {
    const rows = [
      row({ id: "rA", candidateIds: ["c1", "c2"] }),
      row({ id: "rB", candidateIds: ["c1", "c2"] }),
      row({ id: "rC", candidateIds: ["c1", "c2"] }),
    ];
    expect(buildResolvableGroups(rows)).toHaveLength(0);
  });

  it("excludes a receipt with a null amount (cannot bind)", () => {
    const rows = [
      row({ id: "rA", candidateIds: ["c1", "c2"], amount: 1200 }),
      row({ id: "rB", candidateIds: ["c1", "c2"], amount: null }),
    ];
    // rB dropped → only rA left for a 2-charge set → 1 ≠ 2 → not resolvable
    expect(buildResolvableGroups(rows)).toHaveLength(0);
  });

  it("does NOT resolve a same-candidate group with mixed amounts", () => {
    const rows = [
      row({ id: "rA", candidateIds: ["c1", "c2"], amount: 1200 }),
      row({ id: "rB", candidateIds: ["c1", "c2"], amount: 1500 }),
    ];
    expect(buildResolvableGroups(rows)).toHaveLength(0);
  });

  it("keeps distinct landlord groups separate", () => {
    const rows = [
      row({ id: "rA", candidateIds: ["c1", "c2"] }),
      row({ id: "rB", candidateIds: ["c1", "c2"] }),
      row({ id: "rC", candidateIds: ["c3", "c4"] }),
      row({ id: "rD", candidateIds: ["c3", "c4"] }),
    ];
    const groups = buildResolvableGroups(rows);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.pairs.length === 2)).toBe(true);
  });
});
