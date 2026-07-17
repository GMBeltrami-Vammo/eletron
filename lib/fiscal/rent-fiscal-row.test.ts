import { describe, expect, it } from "vitest";

import {
  buildRateioLabel,
  buildRentFiscalRow,
  competenciaLabelBR,
  fiscalCategoryPair,
  formatValorBRThousands,
  RENT_FISCAL_STATUS,
  type RentFiscalRowInput,
} from "./rent-fiscal-row";

const base: RentFiscalRowInput = {
  kind: "aluguel",
  dateSent: "17/07/2026",
  parceiro: "Imobiliária Exemplo Ltda",
  valorTotal: 1020,
  notaFiscal: "12345",
  competencia: "2026-07-01",
  endereco: "Rua das Flores, 100 - São Paulo",
  dueDate: "20/07/2026",
  documentUrl: "https://drive.google.com/file/d/abc/view",
};

describe("formatValorBRThousands", () => {
  it("uses '.' for thousands and ',' for cents", () => {
    expect(formatValorBRThousands(1020)).toBe("1.020,00");
    expect(formatValorBRThousands(3985.2)).toBe("3.985,20");
    expect(formatValorBRThousands(5005.2)).toBe("5.005,20");
    expect(formatValorBRThousands(0)).toBe("0,00");
  });
});

describe("competenciaLabelBR", () => {
  it("renders MM/YYYY, empty on null", () => {
    expect(competenciaLabelBR("2026-07-01")).toBe("07/2026");
    expect(competenciaLabelBR("2026-07")).toBe("07/2026");
    expect(competenciaLabelBR(null)).toBe("");
  });
});

describe("buildRateioLabel", () => {
  it("matches Gabriel's sample (80%/20%)", () => {
    expect(buildRateioLabel(3985.2, 1020)).toBe(
      "Rateio CC401 Energia R$ 3.985,20 (80%) CC402 Aluguel R$ 1.020,00 (20%)",
    );
  });
});

describe("buildRentFiscalRow — aluguel (default)", () => {
  const row = buildRentFiscalRow(base);
  it("has 11 columns in the spec order", () => {
    expect(row).toEqual([
      "17/07/2026",
      "Boletos outros bancos",
      "Imobiliária Exemplo Ltda",
      "1.020,00",
      "12345",
      "Aluguel - Mensalidade Box Vammo - 07/2026 - Rua das Flores, 100 - São Paulo",
      "20/07/2026",
      "402: Charging Infra/Energy: Cabinets Real Estate",
      "COGS - 402: Charging Infra/Energy: Cabinets Real Estate",
      '=HYPERLINK("https://drive.google.com/file/d/abc/view";"Documento")',
      RENT_FISCAL_STATUS,
    ]);
  });
});

describe("buildRentFiscalRow — energia only", () => {
  it("swaps H/I to the 401 codes, keeps the rest", () => {
    const row = buildRentFiscalRow({ ...base, kind: "energia" });
    expect(row[7]).toBe("401: Charging Infra/Energy: Electricity");
    expect(row[8]).toBe("COGS - 401: Charging Infra/Energy: Electricity");
    expect(row[9]).toBe(
      '=HYPERLINK("https://drive.google.com/file/d/abc/view";"Documento")',
    );
    expect(row[10]).toBe(RENT_FISCAL_STATUS);
  });
});

describe("buildRentFiscalRow — aluguel_energia (rateio)", () => {
  it("puts the rateio string in BOTH H and I; rent=contract, energia=remainder", () => {
    // total 5005.20, contract rent 1020 → energia 3985.20 → 80/20
    const row = buildRentFiscalRow({
      ...base,
      kind: "aluguel_energia",
      valorTotal: 5005.2,
      contractRentAmount: 1020,
    });
    const rateio =
      "Rateio CC401 Energia R$ 3.985,20 (80%) CC402 Aluguel R$ 1.020,00 (20%)";
    expect(row[3]).toBe("5.005,20"); // Valor = total
    expect(row[7]).toBe(rateio);
    expect(row[8]).toBe(rateio);
    expect(row[9]).toContain("HYPERLINK");
    expect(row[10]).toBe(RENT_FISCAL_STATUS);
  });

  it("treats a missing contract rent as 0 (100% energia)", () => {
    const { category } = fiscalCategoryPair({
      ...base,
      kind: "aluguel_energia",
      valorTotal: 1000,
      contractRentAmount: null,
    });
    expect(category).toBe(
      "Rateio CC401 Energia R$ 1.000,00 (100%) CC402 Aluguel R$ 0,00 (0%)",
    );
  });
});

describe("buildRentFiscalRow — no document url", () => {
  it("falls back to a plain 'Documento' label", () => {
    const row = buildRentFiscalRow({ ...base, documentUrl: "" });
    expect(row[9]).toBe("Documento");
  });
});
