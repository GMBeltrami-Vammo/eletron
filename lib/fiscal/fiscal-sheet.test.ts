import { describe, expect, it } from "vitest";

import {
  findFaturaRows,
  fiscalTabForDueDate,
  parseFiscalRow,
} from "./fiscal-sheet";

/** The two real rows Gabriel provided (2026-07-10), as raw cell arrays. */
const ENEL_ROW = [
  "08/07/2026 15:06:41",
  "DA",
  "Eletropaulo Metropolitana Eletrecidade de São Paulo S/A",
  "40,24",
  "77815259",
  "Consumo de energia - 204913042",
  "22/07/2026",
  "401: Charging Infra/Energy: Electricity",
  "COGS - 401: Charging Infra/Energy: Electricity",
  "",
  "Upload de Fatura - Aguardando atualização FISCAL",
  "Ver Fatura",
];

const EDP_ROW = [
  "10/07/2026 08:40:33",
  "DA",
  "EDP São Paulo Distribuição de Energia S/A",
  "6797,58",
  "21341357",
  "Consumo de energia - 151405175 DA",
  "20/07/2026",
  "401: Charging Infra/Energy: Electricity",
  "COGS - 401: Charging Infra/Energy: Electricity",
  "",
  "Aguardando Fiscal - Upload via Automatização de planilha.",
  "Ver Fatura",
];

describe("fiscalTabForDueDate", () => {
  it("maps an ISO due date to the MM-YYYY tab", () => {
    expect(fiscalTabForDueDate("2026-07-22")).toBe("07-2026");
    expect(fiscalTabForDueDate("2026-03-01")).toBe("03-2026");
  });

  it("rejects non-ISO input", () => {
    expect(() => fiscalTabForDueDate("22/07/2026")).toThrow();
  });
});

describe("parseFiscalRow", () => {
  it("parses the Enel example row", () => {
    const row = parseFiscalRow(ENEL_ROW, 7);
    expect(row).toEqual({
      rowNumber: 7,
      uploadedAt: "2026-07-08T15:06:41",
      autoDebit: true,
      supplier: "Eletropaulo Metropolitana Eletrecidade de São Paulo S/A",
      valor: 40.24,
      notaFiscal: "77815259",
      installationId: "204913042",
      dueDate: "2026-07-22",
      status: "Upload de Fatura - Aguardando atualização FISCAL",
    });
  });

  it("parses the EDP example row (id with trailing ' DA')", () => {
    const row = parseFiscalRow(EDP_ROW, 2);
    expect(row).toMatchObject({
      installationId: "151405175",
      valor: 6797.58,
      notaFiscal: "21341357",
      dueDate: "2026-07-20",
      uploadedAt: "2026-07-10T08:40:33",
    });
  });

  it("finds the installation id even when columns drift", () => {
    // An extra leading column shifts the description off index 5 — the
    // fallback scan across all cells must still find the id.
    const drifted = ["extra", ...ENEL_ROW];
    const row = parseFiscalRow(drifted, 1);
    expect(row?.installationId).toBe("204913042");
  });

  it("returns null for blank rows", () => {
    expect(parseFiscalRow(["", "", ""], 1)).toBeNull();
    expect(parseFiscalRow([], 1)).toBeNull();
  });
});

describe("findFaturaRows", () => {
  const grid = [ENEL_ROW, EDP_ROW, ["", "", ""]];

  it("finds a fatura by installation id + due date", () => {
    const matches = findFaturaRows(grid, {
      installationId: "204913042",
      dueDate: "2026-07-22",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].notaFiscal).toBe("77815259");
  });

  it("does not match a different installation", () => {
    expect(
      findFaturaRows(grid, {
        installationId: "999999999",
        dueDate: "2026-07-22",
      }),
    ).toHaveLength(0);
  });

  it("does not match when the row's due date disagrees", () => {
    expect(
      findFaturaRows(grid, {
        installationId: "204913042",
        dueDate: "2026-07-30",
      }),
    ).toHaveLength(0);
  });

  it("matches by nota fiscal alone (description typo fallback)", () => {
    const matches = findFaturaRows(grid, {
      installationId: "204913042-typo",
      dueDate: "2026-07-22",
      notaFiscal: "77815259",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].installationId).toBe("204913042");
  });

  it("matches the EDP row by uc", () => {
    const matches = findFaturaRows(grid, {
      installationId: "151405175",
      dueDate: "2026-07-20",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].supplier).toContain("EDP");
  });
});

// Gabriel 2026-07-14: "Verificar no fiscal" must work regardless of DA. A
// non-DA fatura is written with column B = "Boletos outros bancos" and NO " DA"
// suffix on the description — the check must still find it (id + due date;
// column B is never read by the matcher).
describe("findFaturaRows — works for non-DA (Boletos outros bancos) rows", () => {
  const NAO_DA_ROW = [
    "10/07/2026 09:00:00",
    "Boletos outros bancos", // column B — NOT "DA"
    "EDP São Paulo Distribuição de Energia S/A",
    "312,45",
    "88990011",
    "Consumo de energia - 151999888", // no " DA" suffix
    "20/07/2026",
    "401: Charging Infra/Energy: Electricity",
    "COGS - 401: Charging Infra/Energy: Electricity",
    "",
    "Upload de Fatura via Eletron - Aguardando Fiscal",
    "Ver Fatura",
  ];
  it("finds a non-DA fatura by installation id + due date", () => {
    const matches = findFaturaRows([NAO_DA_ROW], {
      installationId: "151999888",
      dueDate: "2026-07-20",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].installationId).toBe("151999888");
    expect(matches[0].autoDebit).toBe(false); // parsed, but not used to match
  });
});
