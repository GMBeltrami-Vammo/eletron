import { describe, expect, it } from "vitest";

import { parseFiscalRow } from "./fiscal-sheet";
import type { FaturaRef } from "./check-faturas";
import {
  buildFiscalRow,
  classifyFaturaForSend,
  fiscalColumnB,
  fiscalTodayISO,
  formatDueDateBR,
  formatValorBR,
  nowFiscalTimestamp,
  selfVerifyRow,
} from "./fiscal-row";

function fatura(overrides: Partial<FaturaRef> = {}): FaturaRef {
  return {
    chargeId: "c-1",
    provider: "enel",
    installationId: "204913042",
    dueDate: "2026-07-22",
    nf: "77815259",
    tab: "07-2026",
    amount: 40.24,
    autoDebit: "cadastrado",
    autoDebitRegistration: "100235348160",
    driveUrl: "https://drive.google.com/file/d/ABC123/view?usp=drivesdk",
    fiscalExported: false,
    ...overrides,
  };
}

const TS = "08/07/2026 15:06:41";

describe("formatValorBR", () => {
  it("comma decimal, no thousands separator (per the samples)", () => {
    expect(formatValorBR(40.24)).toBe("40,24");
    expect(formatValorBR(6797.58)).toBe("6797,58");
    expect(formatValorBR(1528.16)).toBe("1528,16");
    expect(formatValorBR(50.5)).toBe("50,50");
  });
});

describe("formatDueDateBR", () => {
  it("ISO → DD/MM/YYYY", () => {
    expect(formatDueDateBR("2026-07-22")).toBe("22/07/2026");
    expect(formatDueDateBR("2026-01-05")).toBe("05/01/2026");
  });
});

describe("nowFiscalTimestamp", () => {
  it("formats São Paulo local time (UTC-3) as DD/MM/YYYY HH:MM:SS", () => {
    // 2026-07-08T18:06:41Z → 15:06:41 in America/Sao_Paulo (UTC-3, no DST)
    expect(nowFiscalTimestamp(new Date("2026-07-08T18:06:41Z"))).toBe(
      "08/07/2026 15:06:41",
    );
    // midnight boundary
    expect(nowFiscalTimestamp(new Date("2026-07-09T02:30:00Z"))).toBe(
      "08/07/2026 23:30:00",
    );
  });
});

describe("buildFiscalRow — Enel", () => {
  const row = buildFiscalRow(fatura(), TS, ";");
  it("produces the exact 12-column Enel row", () => {
    expect(row).toEqual([
      "08/07/2026 15:06:41",
      "DA",
      "Eletropaulo Metropolitana Eletrecidade de São Paulo S/A",
      "40,24",
      "77815259",
      "Consumo de energia - 204913042", // Enel: NO " DA" suffix
      "22/07/2026",
      "401: Charging Infra/Energy: Electricity",
      "COGS - 401: Charging Infra/Energy: Electricity",
      "",
      "Upload de Fatura via Eletron - Aguardando Fiscal",
      '=HYPERLINK("https://drive.google.com/file/d/ABC123/view?usp=drivesdk";"Ver Fatura")',
    ]);
  });
  it("has exactly 12 columns", () => {
    expect(row).toHaveLength(12);
  });
});

describe("buildFiscalRow — EDP", () => {
  const row = buildFiscalRow(
    fatura({
      provider: "edp",
      installationId: "151405175",
      dueDate: "2026-07-20",
      nf: "21341357",
      amount: 6797.58,
      tab: "07-2026",
    }),
    "10/07/2026 08:40:33",
    ";",
  );
  it("uses the EDP supplier and appends ' DA' to the description", () => {
    expect(row[2]).toBe("EDP São Paulo Distribuição de Energia S/A");
    expect(row[5]).toBe("Consumo de energia - 151405175 DA");
    expect(row[3]).toBe("6797,58");
  });
});

describe("buildFiscalRow — hyperlink separator + missing url", () => {
  it("uses the given separator", () => {
    expect(buildFiscalRow(fatura(), TS, ",")[11]).toBe(
      '=HYPERLINK("https://drive.google.com/file/d/ABC123/view?usp=drivesdk","Ver Fatura")',
    );
  });
  it("falls back to plain 'Ver Fatura' when there is no drive url", () => {
    expect(buildFiscalRow(fatura({ driveUrl: null }), TS, ";")[11]).toBe(
      "Ver Fatura",
    );
  });
});

describe("fiscalColumnB — DA vs Boletos outros bancos (Gabriel 2026-07-14)", () => {
  it("Cadastrado → DA; anything else → Boletos outros bancos", () => {
    expect(fiscalColumnB("cadastrado")).toBe("DA");
    expect(fiscalColumnB("nao_cadastrado")).toBe("Boletos outros bancos");
    expect(fiscalColumnB("desconhecido")).toBe("Boletos outros bancos");
  });
  it("buildFiscalRow col B follows the fatura's DA status", () => {
    expect(buildFiscalRow(fatura({ autoDebit: "cadastrado" }), TS, ";")[1]).toBe("DA");
    expect(buildFiscalRow(fatura({ autoDebit: "nao_cadastrado" }), TS, ";")[1]).toBe(
      "Boletos outros bancos",
    );
  });
});

describe("fiscalTodayISO (São Paulo date)", () => {
  it("returns the São Paulo calendar date (UTC-3)", () => {
    expect(fiscalTodayISO(new Date("2026-07-10T12:00:00Z"))).toBe("2026-07-10");
    // 02:00 UTC is still the previous day in São Paulo
    expect(fiscalTodayISO(new Date("2026-07-10T02:00:00Z"))).toBe("2026-07-09");
  });
});

describe("classifyFaturaForSend", () => {
  const base = {
    registered: false,
    tabExists: true,
    amount: 100 as number | null,
    dueDate: "2026-07-15",
    autoDebit: "cadastrado",
  };
  const today = "2026-07-10";
  const cls = (o: Partial<typeof base>) =>
    classifyFaturaForSend({ ...base, ...o }, today);

  it("value 0 wins over everything (even if registered)", () => {
    expect(cls({ amount: 0 })).toBe("zero");
    expect(cls({ amount: 0, registered: true })).toBe("zero");
    expect(cls({ amount: 0, dueDate: "2025-01-01" })).toBe("zero");
  });
  it("already on the sheet → registered", () => {
    expect(cls({ registered: true })).toBe("registered");
  });
  it("null amount → noValor", () => {
    expect(cls({ amount: null })).toBe("noValor");
  });
  it("due-year ≤ 2025 → ignoredPast, ≥ 2027 → blockedFuture", () => {
    expect(cls({ dueDate: "2025-12-01" })).toBe("ignoredPast");
    expect(cls({ dueDate: "2027-01-10" })).toBe("blockedFuture");
  });
  it("due date already passed → pastDue (today itself is NOT passed)", () => {
    expect(cls({ dueDate: "2026-07-09" })).toBe("pastDue");
    expect(cls({ dueDate: "2026-07-10" })).toBe("send"); // == today
  });
  it("2026 without débito automático → send (all not-overdue send; Gabriel 2026-07-14)", () => {
    expect(cls({ autoDebit: "nao_cadastrado" })).toBe("send");
    expect(cls({ autoDebit: "desconhecido" })).toBe("send");
  });
  it("2026 Cadastrado but no month tab → semAba", () => {
    expect(cls({ tabExists: false })).toBe("semAba");
  });
  it("2026, Cadastrado, future due, tab exists → send", () => {
    expect(cls({})).toBe("send");
  });
});

describe("selfVerifyRow (round-trip through the READ parser)", () => {
  it("accepts a correctly-built Enel row", () => {
    const f = fatura();
    expect(selfVerifyRow(buildFiscalRow(f, TS, ";"), f)).toBe(true);
  });
  it("accepts a correctly-built EDP row (id extracted despite ' DA')", () => {
    const f = fatura({
      provider: "edp",
      installationId: "151405175",
      dueDate: "2026-07-20",
      nf: "21341357",
      amount: 6797.58,
    });
    const row = buildFiscalRow(f, "10/07/2026 08:40:33", ";");
    expect(selfVerifyRow(row, f)).toBe(true);
    // and the read parser recovers the id/valor/nf/due date exactly
    const parsed = parseFiscalRow(row, 1);
    expect(parsed).toMatchObject({
      installationId: "151405175",
      valor: 6797.58,
      notaFiscal: "21341357",
      dueDate: "2026-07-20",
    });
  });
  it("rejects a row whose valor was corrupted", () => {
    const f = fatura();
    const row = buildFiscalRow(f, TS, ";");
    row[3] = "999,99";
    expect(selfVerifyRow(row, f)).toBe(false);
  });
  it("rejects a row whose installation id was corrupted", () => {
    const f = fatura();
    const row = buildFiscalRow(f, TS, ";");
    row[5] = "Consumo de energia - 111111111";
    expect(selfVerifyRow(row, f)).toBe(false);
  });
  it("tolerates a null nota fiscal both ways", () => {
    const f = fatura({ nf: null });
    expect(selfVerifyRow(buildFiscalRow(f, TS, ";"), f)).toBe(true);
  });
});
