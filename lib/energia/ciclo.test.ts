import { describe, expect, it } from "vitest";

import { energyCicloStage } from "./ciclo";

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
