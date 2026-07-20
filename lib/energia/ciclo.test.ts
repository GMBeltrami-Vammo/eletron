import { describe, expect, it } from "vitest";

import { energyCicloIsPaid, energyCicloStage } from "./ciclo";

describe("energyCicloStage", () => {
  const base = {
    hasBillSignal: true,
    hasParsedCharge: false,
    fiscalExported: false,
    isPaid: false,
  };

  it("1 · Detectada — bill signal without a parsed charge", () => {
    expect(energyCicloStage(base)).toBe(1);
  });

  it("2 · Analisada — parsed charge, not fiscal, not paid", () => {
    expect(energyCicloStage({ ...base, hasParsedCharge: true })).toBe(2);
  });

  it("3 · Enviada ao fiscal — parsed + fiscal_exported, unpaid", () => {
    expect(
      energyCicloStage({ ...base, hasParsedCharge: true, fiscalExported: true }),
    ).toBe(3);
  });

  it("4 · Paga — comprovante vinculado wins over everything", () => {
    expect(
      energyCicloStage({
        ...base,
        hasParsedCharge: true,
        fiscalExported: true,
        isPaid: true,
      }),
    ).toBe(4);
  });

  it("4 · Paga even when the fiscal export was skipped (furthest point wins)", () => {
    expect(
      energyCicloStage({ ...base, hasParsedCharge: true, isPaid: true }),
    ).toBe(4);
  });

  it("fiscal flag without a parsed charge does NOT reach stage 3 (no PDF yet)", () => {
    expect(energyCicloStage({ ...base, fiscalExported: true })).toBe(1);
  });

  it("null — no bill at all", () => {
    expect(
      energyCicloStage({ ...base, hasBillSignal: false }),
    ).toBeNull();
  });
});

describe("energyCicloIsPaid (Gabriel 2026-07-18: Paga exige comprovante)", () => {
  it("comprovante bound → paid", () => {
    expect(
      energyCicloIsPaid({ settled: false, amount: 120, hasComprovante: true }),
    ).toBe(true);
  });

  it("settled 'pago' WITHOUT comprovante (clone/portal) → NOT paid", () => {
    expect(
      energyCicloIsPaid({ settled: true, amount: 120, hasComprovante: false }),
    ).toBe(false);
  });

  it("R$0 fatura settled without comprovante → paid (#42 exception)", () => {
    expect(
      energyCicloIsPaid({ settled: true, amount: 0, hasComprovante: false }),
    ).toBe(true);
  });

  it("R$0 but NOT settled → not paid", () => {
    expect(
      energyCicloIsPaid({ settled: false, amount: 0, hasComprovante: false }),
    ).toBe(false);
  });

  it("open charge, no comprovante → not paid", () => {
    expect(
      energyCicloIsPaid({ settled: false, amount: 90, hasComprovante: false }),
    ).toBe(false);
  });

  it("legacy_closed (pre-cutoff backlog, #71) → paid even without comprovante/settled", () => {
    expect(
      energyCicloIsPaid({
        settled: false,
        amount: 90,
        hasComprovante: false,
        legacyClosed: true,
      }),
    ).toBe(true);
  });
});
