import { describe, expect, it } from "vitest";

import { matchReceipt, pinnedCompetencia } from "./match";
import type { OpenChargeCandidate, ParsedReceipt } from "./types";

function receipt(overrides: Partial<ParsedReceipt>): ParsedReceipt {
  return {
    pageNumber: 1,
    segmentIndex: 0,
    receiptType: "pix",
    amount: null,
    paidAt: null,
    chavePix: null,
    chavePixNormalized: null,
    cnpjCpf: null,
    banco: null,
    agencia: null,
    conta: null,
    identificacao: null,
    autenticacao: null,
    codigoBarras: null,
    ctrl: null,
    utility: null,
    rawText: "",
    ...overrides,
  };
}

function candidate(overrides: Partial<OpenChargeCandidate>): OpenChargeCandidate {
  return {
    chargeId: "c-0",
    amount: null,
    competencia: null,
    dueDate: null,
    chavePix: null,
    issuerCnpj: null,
    agencia: null,
    conta: null,
    linhaDigitavel: null,
    autoDebitRegistration: null,
    billAutoDebit: null,
    valueTolerance: 0.01,
    isOpen: true,
    ...overrides,
  };
}

describe("matchReceipt", () => {
  it("auto-matches a single candidate by chave PIX", () => {
    const r = receipt({
      chavePix: "financeiro@fornecedor.com",
      amount: 100,
      paidAt: "2026-05-28",
    });
    const cands = [
      candidate({ chargeId: "c-1", chavePix: "financeiro@fornecedor.com", amount: 100, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.rule).toBe("chave_pix");
    expect(res.chargeId).toBe("c-1");
  });

  it("auto-matches by CNPJ (digits-only equality)", () => {
    const r = receipt({ cnpjCpf: "12345678000199", amount: 200, paidAt: "2026-05-30" });
    const cands = [
      candidate({ chargeId: "c-2", issuerCnpj: "12.345.678/0001-99", amount: 200, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.rule).toBe("cnpj_cpf");
    expect(res.chargeId).toBe("c-2");
  });

  it("auto-matches débito automático by codigoBarras ⊂ auto_debit_registration, date-exempt", () => {
    const r = receipt({
      receiptType: "debito_automatico",
      codigoBarras: "123456",
      amount: 250,
      paidAt: "2026-01-15", // day 15 → outside the 25/10 window, but rank 1 is exempt
    });
    const cands = [
      candidate({
        chargeId: "c-3",
        autoDebitRegistration: "X123456Y",
        amount: 250,
        competencia: "2026-05-01", // mismatched month, ignored for barcode rank
      }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.rule).toBe("codigo_barras");
    expect(res.chargeId).toBe("c-3");
  });

  it("flags ambiguous when two candidates share value + chave", () => {
    const r = receipt({ chavePix: "a@b.com", amount: 50, paidAt: "2026-05-28" });
    const cands = [
      candidate({ chargeId: "c-a", chavePix: "a@b.com", amount: 50, competencia: "2026-05-01" }),
      candidate({ chargeId: "c-b", chavePix: "a@b.com", amount: 50, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous");
    expect(res.candidateIds).toHaveLength(2);
  });

  it("returns none when no key hits", () => {
    const r = receipt({ chavePix: "nobody@nowhere.com", amount: 10 });
    const cands = [candidate({ chargeId: "c-x", chavePix: "someone@else.com", amount: 10 })];
    expect(matchReceipt(r, cands).outcome).toBe("none");
  });

  it("honors per-counterparty value tolerance (Kitchen Central 1.00)", () => {
    const r = receipt({ cnpjCpf: "11111111000111", amount: 100, paidAt: "2026-05-28" });
    const withTolerance = candidate({
      chargeId: "kc",
      issuerCnpj: "11111111000111",
      amount: 101, // 1.00 off — within the 1.00 tolerance
      valueTolerance: 1.0,
      competencia: "2026-05-01",
    });
    expect(matchReceipt(r, [withTolerance]).outcome).toBe("auto");

    const tight = candidate({
      chargeId: "tight",
      issuerCnpj: "11111111000111",
      amount: 100.5, // 0.50 off — outside the default 0.01
      valueTolerance: 0.01,
      competencia: "2026-05-01",
    });
    // the CNPJ key matched → never discard on a value miss (juros/multa case);
    // rule-1 discard requires the receipt to be key-alien too
    expect(matchReceipt(r, [tight]).outcome).toBe("none");
  });

  it("prefers the single OPEN survivor when an already-paid charge also matches", () => {
    const r = receipt({ chavePix: "shared@x.com", amount: 100, paidAt: "2026-05-28" });
    const cands = [
      candidate({ chargeId: "paid", chavePix: "shared@x.com", amount: 100, competencia: "2026-05-01", isOpen: false }),
      candidate({ chargeId: "open", chavePix: "shared@x.com", amount: 100, competencia: "2026-05-01", isOpen: true }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.chargeId).toBe("open");
  });

  it("stays ambiguous when two OPEN charges share value + chave", () => {
    const r = receipt({ chavePix: "a@b.com", amount: 50, paidAt: "2026-05-28" });
    const cands = [
      candidate({ chargeId: "o1", chavePix: "a@b.com", amount: 50, competencia: "2026-05-01", isOpen: true }),
      candidate({ chargeId: "o2", chavePix: "a@b.com", amount: 50, competencia: "2026-05-01", isOpen: true }),
    ];
    expect(matchReceipt(r, cands).outcome).toBe("ambiguous");
  });

  it("pins the competência by payment date (day ≥ 20 → same month)", () => {
    const r = receipt({ chavePix: "x@y.com", amount: 75, paidAt: "2026-05-28" });
    const cands = [
      candidate({ chargeId: "apr", chavePix: "x@y.com", amount: 75, competencia: "2026-04-01" }),
      candidate({ chargeId: "may", chavePix: "x@y.com", amount: 75, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.chargeId).toBe("may");
  });

  it("pins the competência to the PREVIOUS month when day < 20 (GT: 05/06 → maio)", () => {
    const r = receipt({ chavePix: "x@y.com", amount: 75, paidAt: "2026-06-05" });
    const cands = [
      candidate({ chargeId: "may", chavePix: "x@y.com", amount: 75, competencia: "2026-05-01", isOpen: false }),
      candidate({ chargeId: "jun", chavePix: "x@y.com", amount: 75, competencia: "2026-06-01", isOpen: true }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    // the paid May charge wins over the open June one — the DATE decides
    expect(res.chargeId).toBe("may");
  });

  it("sends a key+value match OUTSIDE the pinned competência to human review", () => {
    const r = receipt({ chavePix: "x@y.com", amount: 75, paidAt: "2026-06-05" }); // → maio
    const cands = [
      candidate({ chargeId: "jul", chavePix: "x@y.com", amount: 75, competencia: "2026-07-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous");
    expect(res.candidateIds).toEqual(["jul"]);
    expect(res.reasons.join(" ")).toContain("validação humana");
  });

  it("discards a receipt whose amount matches NO charge in the pool (rule 1)", () => {
    const r = receipt({ cnpjCpf: "92693118000160", amount: 284012.02, paidAt: "2026-06-05" });
    const cands = [candidate({ chargeId: "c1", amount: 900 }), candidate({ chargeId: "c2", amount: 1200 })];
    expect(matchReceipt(r, cands).outcome).toBe("discard");
  });

  it("never discards a null-amount receipt (parser failure ≠ alien payment)", () => {
    const r = receipt({ chavePix: "x@y.com", amount: null });
    const cands = [candidate({ chargeId: "c1", chavePix: "x@y.com", amount: 900 })];
    expect(matchReceipt(r, cands).outcome).toBe("none");
  });

  it("never discards a KEY-matching receipt even when the amount diverges (juros/multa)", () => {
    // late rent paid with multa: R$1.530 vs charge R$1.500 — key hit → human, not discard
    const r = receipt({ chavePix: "landlord@x.com", amount: 1530, paidAt: "2026-06-05" });
    const cands = [
      candidate({ chargeId: "c1", chavePix: "landlord@x.com", amount: 1500, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("none"); // needs_review, NOT rejected
  });

  it("judges rule-1 against the FULL pool, not the batch-spliced one", () => {
    // the only R$900 charge was consumed earlier in the batch (spliced pool is
    // empty) — the second R$900 receipt must go to review, not be discarded
    const full = [candidate({ chargeId: "c1", chavePix: "a@b.com", amount: 900 })];
    const spliced: typeof full = [];
    const r = receipt({ chavePix: "other@key.com", amount: 900, paidAt: "2026-06-05" });
    expect(matchReceipt(r, spliced, full).outcome).toBe("none");
    // without the full pool it would discard
    expect(matchReceipt(r, spliced).outcome).toBe("discard");
  });

  it("does NOT let prefer-open guess across months for a DATELESS receipt", () => {
    const r = receipt({ chavePix: "x@y.com", amount: 900, paidAt: null });
    const cands = [
      candidate({ chargeId: "may", chavePix: "x@y.com", amount: 900, competencia: "2026-05-01", isOpen: false }),
      candidate({ chargeId: "jun", chavePix: "x@y.com", amount: 900, competencia: "2026-06-01", isOpen: false }),
      candidate({ chargeId: "jul", chavePix: "x@y.com", amount: 900, competencia: "2026-07-01", isOpen: true }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous"); // "the one still open" is a guess
    expect(res.candidateIds).toHaveLength(3);
  });

  it("goes to review when a NULL-competência survivor can't be ruled out by the pin", () => {
    const r = receipt({ chavePix: "x@y.com", amount: 900, paidAt: "2026-06-05" }); // → maio
    const cands = [
      candidate({ chargeId: "may", chavePix: "x@y.com", amount: 900, competencia: "2026-05-01" }),
      candidate({ chargeId: "unk", chavePix: "x@y.com", amount: 900, competencia: null }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous");
    expect(res.candidateIds).toEqual(expect.arrayContaining(["may", "unk"]));
  });

  it("sends a barcode hit whose VALUE disagrees to review — never a weaker-rank auto", () => {
    const r = receipt({
      receiptType: "debito_automatico",
      codigoBarras: "12345678",
      cnpjCpf: "61695227000193",
      amount: 500,
      paidAt: "2026-06-05",
    });
    const cands = [
      // the barcode names THIS bill, but its amount is 480 (out of tolerance)
      candidate({ chargeId: "x", autoDebitRegistration: "12345678", amount: 480, competencia: "2026-05-01" }),
      // a sibling of the same utility CNPJ at exactly 500 — must NOT auto-bind
      candidate({ chargeId: "y", issuerCnpj: "61695227000193", amount: 500, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous");
    expect(res.rule).toBe("codigo_barras");
    expect(res.candidateIds).toEqual(["x"]);
  });

  it("falls through to the next rank when the winning rank's value filters everything (GT p40/p144)", () => {
    // pix rank hits other-month charges at the wrong value; cnpj rank has the
    // right charge — the rank must yield instead of ending the match.
    const r = receipt({
      chavePix: "34528623803",
      cnpjCpf: "34528623803",
      amount: 1500,
      paidAt: "2026-06-05", // → maio
    });
    const cands = [
      candidate({ chargeId: "wrong-val", chavePix: "34528623803", amount: 2000, competencia: "2026-05-01" }),
      candidate({ chargeId: "right", chavePix: "220349-9", issuerCnpj: "34528623803", amount: 1500, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.rule).toBe("cnpj_cpf");
    expect(res.chargeId).toBe("right");
  });

  it("matches digit keys leading-zero-insensitively (clone lost zeros; banks pad)", () => {
    // charge pix lost its leading zero in the numeric sheet cell (GT p78)
    const pix = receipt({ chavePix: "01610670000192", amount: 900, paidAt: "2026-06-05" });
    const pixCand = [
      candidate({ chargeId: "c", chavePix: "1610670000192", amount: 900, competencia: "2026-05-01" }),
    ];
    expect(matchReceipt(pix, pixCand).chargeId).toBe("c");

    // bank zero-pads the CPF and agência/conta (GT p70: Nubank TED C)
    const ted = receipt({
      receiptType: "ted",
      cnpjCpf: "00022820227856",
      agencia: "0001",
      conta: "0000004000921",
      amount: 1000,
      paidAt: "2026-06-05",
    });
    const tedCand = [
      candidate({
        chargeId: "t",
        issuerCnpj: "22820227856",
        agencia: "1",
        conta: "400092-1",
        amount: 1000,
        competencia: "2026-05-01",
      }),
    ];
    expect(matchReceipt(ted, tedCand).chargeId).toBe("t");
  });
});

describe("pinnedCompetencia", () => {
  it("maps [20/MM, 20/MM+1) → MM, with year wrap", () => {
    expect(pinnedCompetencia("2026-06-05")).toBe("2026-05"); // day < 20 → previous
    expect(pinnedCompetencia("2026-06-20")).toBe("2026-06"); // day ≥ 20 → same
    expect(pinnedCompetencia("2026-06-25")).toBe("2026-06");
    expect(pinnedCompetencia("2026-01-10")).toBe("2025-12"); // January wraps
    expect(pinnedCompetencia(null)).toBeNull();
    expect(pinnedCompetencia("garbage")).toBeNull();
  });
});

describe("payment-type gate (DA vs manual, Gabriel 2026-07-14)", () => {
  const BARCODE = "83650000000249490048100810754907461800243965709";

  it("manual receipt does NOT auto-bind a DA bill — directed review instead", () => {
    const r = receipt({
      receiptType: "boleto_barcode",
      codigoBarras: BARCODE,
      amount: 49.49,
      paidAt: "2026-06-19",
    });
    const cands = [
      candidate({
        chargeId: "da-bill",
        linhaDigitavel: BARCODE,
        amount: 49.49,
        competencia: "2026-07-01",
        billAutoDebit: "cadastrado",
      }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous");
    expect(res.chargeId).toBeUndefined();
    expect(res.candidateIds).toContain("da-bill");
  });

  it("DA receipt does NOT auto-bind a non-DA bill — directed review instead", () => {
    const r = receipt({
      receiptType: "debito_automatico",
      codigoBarras: "42142385",
      amount: 1628.07,
      paidAt: "2026-06-22",
    });
    const cands = [
      candidate({
        chargeId: "manual-bill",
        autoDebitRegistration: "10042142385999",
        amount: 1628.07,
        competencia: "2026-06-01",
        billAutoDebit: "nao_cadastrado",
      }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("ambiguous");
    expect(res.candidateIds).toContain("manual-bill");
  });

  it("DA receipt auto-binds a DA bill (via DA code ⊂ auto_debit_registration)", () => {
    const r = receipt({
      receiptType: "debito_automatico",
      codigoBarras: "42142385",
      amount: 1628.07,
      paidAt: "2026-06-22",
    });
    const cands = [
      candidate({
        chargeId: "da",
        autoDebitRegistration: "10042142385999",
        amount: 1628.07,
        competencia: "2026-06-01",
        billAutoDebit: "cadastrado",
      }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.chargeId).toBe("da");
  });

  it("manual receipt auto-binds a non-DA bill (via barcode = linha digitável)", () => {
    const r = receipt({
      receiptType: "boleto_barcode",
      codigoBarras: BARCODE,
      amount: 49.49,
      paidAt: "2026-06-19",
    });
    const cands = [
      candidate({
        chargeId: "manual",
        linhaDigitavel: BARCODE,
        amount: 49.49,
        billAutoDebit: "nao_cadastrado",
      }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.chargeId).toBe("manual");
  });

  it("unknown bill DA (null/desconhecido, e.g. rent) is NOT gated — binds as before", () => {
    const r = receipt({
      receiptType: "boleto_barcode",
      codigoBarras: BARCODE,
      amount: 49.49,
      paidAt: "2026-06-19",
    });
    const cands = [
      candidate({ chargeId: "unk", linhaDigitavel: BARCODE, amount: 49.49, billAutoDebit: null }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.chargeId).toBe("unk");
  });
});
