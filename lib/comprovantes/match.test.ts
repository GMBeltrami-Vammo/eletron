import { describe, expect, it } from "vitest";

import { matchReceipt } from "./match";
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

  it("uses the date window to disambiguate two open months", () => {
    const r = receipt({ chavePix: "x@y.com", amount: 75, paidAt: "2026-05-28" });
    const cands = [
      candidate({ chargeId: "apr", chavePix: "x@y.com", amount: 75, competencia: "2026-04-01" }),
      candidate({ chargeId: "may", chavePix: "x@y.com", amount: 75, competencia: "2026-05-01" }),
    ];
    const res = matchReceipt(r, cands);
    expect(res.outcome).toBe("auto");
    expect(res.chargeId).toBe("may");
  });
});
