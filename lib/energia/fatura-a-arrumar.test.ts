import { describe, expect, it } from "vitest";

import { faturaGaps, isFaturaAArrumar, type FaturaFields } from "./fatura-a-arrumar";

const complete: FaturaFields = {
  dueDate: "2026-07-22",
  competencia: "2026-07-01",
  amount: 1829.06,
  nf: "021986636",
  settled: false,
  legacyClosed: false,
};

describe("faturaGaps / isFaturaAArrumar", () => {
  it("fatura completa não é a arrumar", () => {
    expect(faturaGaps(complete)).toEqual([]);
    expect(isFaturaAArrumar(complete)).toBe(false);
  });

  it("sem vencimento", () => {
    expect(faturaGaps({ ...complete, dueDate: null })).toContain("vencimento");
    expect(isFaturaAArrumar({ ...complete, dueDate: null })).toBe(true);
  });

  it("sem competência (o caso da duplicata :na)", () => {
    expect(faturaGaps({ ...complete, competencia: null })).toContain("competencia");
  });

  it("sem NF (nulo ou em branco)", () => {
    expect(faturaGaps({ ...complete, nf: null })).toContain("nf");
    expect(faturaGaps({ ...complete, nf: "   " })).toContain("nf");
  });

  it("valor nulo é a arrumar", () => {
    expect(faturaGaps({ ...complete, amount: null })).toContain("valor");
  });

  it("R$0 NÃO-pago (nem legacy) = sem valor", () => {
    expect(faturaGaps({ ...complete, amount: 0, settled: false, legacyClosed: false })).toContain(
      "valor",
    );
  });

  it("R$0 pago (#42) NÃO é a arrumar — valor legítimo", () => {
    expect(faturaGaps({ ...complete, amount: 0, settled: true })).not.toContain("valor");
  });

  it("R$0 legacy-closed (#71) NÃO é a arrumar", () => {
    expect(faturaGaps({ ...complete, amount: 0, legacyClosed: true })).not.toContain("valor");
  });

  it("acumula múltiplos gaps", () => {
    expect(
      faturaGaps({ ...complete, dueDate: null, competencia: null, nf: "" }).sort(),
    ).toEqual(["competencia", "nf", "vencimento"]);
  });
});
