import { describe, expect, it } from "vitest";
import {
  edpChargeDedupeKey,
  enelChargeDedupeKey,
  extractHyperlinkUrl,
  extractLeadingIsoDate,
  pagamentosChargeDedupeKey,
  parseAutoDebit,
  parseBillStatus,
  parseBoolean,
  parseCompetenciaFromMesAno,
  parseCoordinate,
  parseDateISO,
  parseMoney,
  parseMonthYearLabel,
  parseShutdown,
  parseStationId,
  parseTimestamp,
  parseValorCell,
  splitMultiValue,
  stripTrailingDotZero,
  unpivotEdpMonths,
  unpivotEnelMonths,
  zipInstallations,
} from "./normalize";

describe("parseMoney (pt-BR and en-US renderings)", () => {
  it("parses pt-BR money with R$, thousands dots and comma decimals", () => {
    expect(parseMoney("R$ 6.502,34")).toBe(6502.34);
    expect(parseMoney("R$48,58")).toBe(48.58);
    expect(parseMoney("R$0,00")).toBe(0);
    expect(parseMoney("1.042,29")).toBe(1042.29);
  });

  it("parses NBSP-polluted money", () => {
    expect(parseMoney("R$ 7.028,04")).toBe(7028.04);
    expect(parseMoney("R$ 1.500,00")).toBe(1500);
  });

  it("parses en-US renderings (xlsx fixture formatting)", () => {
    expect(parseMoney("R$1,200.00")).toBe(1200);
    expect(parseMoney("6,663.00")).toBe(6663);
    expect(parseMoney("289.47")).toBe(289.47);
    expect(parseMoney("R$ 300.00")).toBe(300);
  });

  it("parses bare integers and single-separator edge cases", () => {
    expect(parseMoney("R$1500")).toBe(1500);
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney("6.502")).toBe(6502); // pt-BR thousands, no decimals
    expect(parseMoney("1,200")).toBe(1200); // en-US thousands, no decimals
    expect(parseMoney("969.3")).toBe(969.3);
    expect(parseMoney("1100.0")).toBe(1100);
    expect(parseMoney("-1.262,07")).toBe(-1262.07);
  });

  it("returns null for empty and junk (never NaN)", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("UNIDENTIFIED")).toBeNull();
    expect(parseMoney("R$")).toBeNull();
    expect(parseMoney("abc12")).toBeNull();
  });
});

describe("parseValorCell (polluted 2_Pagamentos Valor)", () => {
  it("parses plain money", () => {
    const r = parseValorCell("R$1,200.00");
    expect(r.kind).toBe("plain");
    expect(r.amount).toBe(1200);
    expect(r.expectedAmount).toBeNull();
  });

  it("parses 'Documento / Planilha / Energia'", () => {
    const r = parseValorCell(
      "Documento: 5639.8 / Planilha: 1000 / Energia: 4726.8",
    );
    expect(r.kind).toBe("labeled");
    expect(r.amount).toBe(5639.8);
    expect(r.expectedAmount).toBe(1000);
    expect(r.energyAmount).toBe(4726.8);
  });

  it("parses the no-space-before-slash variant", () => {
    const r = parseValorCell("Documento: 1021/ Planilha: 1000");
    expect(r.amount).toBe(1021);
    expect(r.expectedAmount).toBe(1000);
    expect(r.energyAmount).toBeNull();
  });

  it("parses money-formatted values inside the labels", () => {
    const r = parseValorCell("Documento: R$1.262,07 / Planilha: 1262.07");
    expect(r.amount).toBe(1262.07);
    expect(r.expectedAmount).toBe(1262.07);
  });

  it("keeps UNIDENTIFIED Planilha as null without failing the row", () => {
    const r = parseValorCell(
      "Documento: 3106.9 / Planilha: UNIDENTIFIED / Energia: 2193.9",
    );
    expect(r.kind).toBe("labeled");
    expect(r.amount).toBe(3106.9);
    expect(r.expectedAmount).toBeNull();
    expect(r.energyAmount).toBe(2193.9);
  });

  it("parses the Manager 'Boleto / Locação' variant", () => {
    const r = parseValorCell("Boleto: 5851.62/ Locação: 1121.27");
    expect(r.kind).toBe("labeled");
    expect(r.amount).toBe(5851.62);
    expect(r.rentAmount).toBe(1121.27);
  });

  it("flags unparseable cells", () => {
    const r = parseValorCell("a combinar");
    expect(r.kind).toBe("unparseable");
    expect(r.amount).toBeNull();
    expect(r.raw).toBe("a combinar");
  });
});

describe("parseDateISO / parseTimestamp (explicit format list)", () => {
  it("parses ISO dates", () => {
    expect(parseDateISO("2026-05-20")).toBe("2026-05-20");
  });

  it("parses DD/MM/YYYY", () => {
    expect(parseDateISO("16/05/2026")).toBe("2026-05-16");
    expect(parseDateISO("3/7/2026")).toBe("2026-07-03");
  });

  it("parses DD/MM/YY as 20YY (EDP due dates)", () => {
    expect(parseDateISO("03/07/26")).toBe("2026-07-03");
    expect(parseDateISO("21/07/26")).toBe("2026-07-21");
  });

  it("rejects garbage instead of Date.parse guessing", () => {
    expect(parseDateISO("July 3, 2026")).toBeNull();
    expect(parseDateISO("2026-13-01")).toBeNull();
    expect(parseDateISO("")).toBeNull();
  });

  it("parses scraper timestamps (BRT wall clock, single-digit hours)", () => {
    expect(parseTimestamp("2026-06-08 13:41:16")).toBe("2026-06-08T13:41:16");
    expect(parseTimestamp("2026-04-27 9:05:14")).toBe("2026-04-27T09:05:14");
  });

  it("passes full ISO offsets through (backoffice created_at)", () => {
    expect(parseTimestamp("2022-11-02T17:01:40.029-03:00")).toBe(
      "2022-11-02T17:01:40.029-03:00",
    );
  });
});

describe("parseAutoDebit", () => {
  it("maps both accent variants", () => {
    expect(parseAutoDebit("Cadastrado").status).toBe("cadastrado");
    expect(parseAutoDebit("Não cadastrado").status).toBe("nao_cadastrado");
    expect(parseAutoDebit("Nao Cadastrado").status).toBe("nao_cadastrado");
    expect(parseAutoDebit("NÃO CADASTRADO").status).toBe("nao_cadastrado");
  });

  it("junk → desconhecido with the unknown-literal flag", () => {
    const junk = parseAutoDebit("talvez");
    expect(junk.status).toBe("desconhecido");
    expect(junk.unknownLiteral).toBe(true);
    const empty = parseAutoDebit("");
    expect(empty.status).toBe("desconhecido");
    expect(empty.unknownLiteral).toBe(false);
  });
});

describe("parseStationId (sentinels)", () => {
  it("maps sentinels to null without error", () => {
    for (const v of ["UNIDENTIFIED", "Unidentified", "", "N/A", "  "]) {
      const r = parseStationId(v);
      expect(r.stationId).toBeNull();
      expect(r.sentinel).toBe(true);
      expect(r.error).toBeNull();
    }
  });

  it("strips trailing .0 and parses integers", () => {
    expect(parseStationId("3102").stationId).toBe(3102);
    expect(parseStationId("3102.0").stationId).toBe(3102);
    expect(stripTrailingDotZero("1100.0")).toBe("1100");
  });

  it("rejects non-integers with an error (never silently)", () => {
    const r = parseStationId("hg  hhhJ");
    expect(r.stationId).toBeNull();
    expect(r.sentinel).toBe(false);
    expect(r.error).toContain("hg  hhhJ");
  });
});

describe("parseBillStatus (fixed literal map)", () => {
  it("maps every known portal literal", () => {
    expect(parseBillStatus("Paga").status).toBe("paga");
    expect(parseBillStatus("Pendente").status).toBe("pendente");
    expect(parseBillStatus("A Vencer").status).toBe("a_vencer");
    expect(parseBillStatus("Vencida").status).toBe("vencida");
    expect(parseBillStatus("Sem contas").status).toBe("sem_contas");
    expect(parseBillStatus("Em Compensação").status).toBe("em_compensacao");
    expect(parseBillStatus("Fatura negociada").status).toBe("fatura_negociada");
    expect(parseBillStatus("N/A").status).toBe("na");
  });

  it("captures unknown literals instead of mis-mapping", () => {
    const r = parseBillStatus("Extrato");
    expect(r.status).toBeNull();
    expect(r.unknownLiteral).toBe(true);
    expect(r.raw).toBe("Extrato");
  });
});

describe("coordinates (comma vs dot decimals)", () => {
  it("detects the separator per value", () => {
    expect(parseCoordinate("-23,55")).toBe(-23.55);
    expect(parseCoordinate("-23.5951967")).toBe(-23.5951967);
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate("SRID=4326")).toBeNull();
  });
});

describe("competência parsing", () => {
  it("Mês pt-BR + Ano → YYYY-MM-01", () => {
    expect(parseCompetenciaFromMesAno("Junho", "2026")).toBe("2026-06-01");
    expect(parseCompetenciaFromMesAno("Março", "2026")).toBe("2026-03-01");
    expect(parseCompetenciaFromMesAno("maio", "2026")).toBe("2026-05-01");
    expect(parseCompetenciaFromMesAno("", "2026")).toBeNull();
    expect(parseCompetenciaFromMesAno("Junho", "")).toBeNull();
  });

  it("negotiated labels in pt AND English, any casing", () => {
    expect(parseMonthYearLabel("Março/26")).toBe("2026-03");
    expect(parseMonthYearLabel("January/26")).toBe("2026-01");
    expect(parseMonthYearLabel("dezembro/25")).toBe("2025-12");
    expect(parseMonthYearLabel("July/25")).toBe("2025-07");
    expect(parseMonthYearLabel("mai/26")).toBeNull(); // abbreviations are not labels
  });
});

describe("month-matrix unpivot", () => {
  it("unpivots ENEL F_/R_ uppercase pt-BR columns", () => {
    const cells = unpivotEnelMonths({
      enel_id: "123",
      F_JUN26: "452",
      R_JUN26: "0",
      F_MAI26: "6,663.00",
      R_MAI26: "",
      F_XXX26: "99", // not a pt month — ignored
      other: "1",
    });
    const byKey = new Map(
      cells.map((c) => [`${c.competencia}:${c.kind}`, c.value]),
    );
    expect(byKey.get("2026-06-01:billed")).toBe(452);
    expect(byKey.get("2026-06-01:recorded")).toBe(0);
    expect(byKey.get("2026-05-01:billed")).toBe(6663);
    expect(byKey.has("2026-05-01:recorded")).toBe(false); // empty cell skipped
    expect(cells).toHaveLength(3);
  });

  it("unpivots EDP lowercase mmmaa columns and skips the stale English duplicates", () => {
    const cells = unpivotEdpMonths({
      uc: "151436233",
      jun26: "6,663.00",
      mai26: "6,129.00",
      jul25: "3,178.00",
      Jun26: "6,663.00", // English-cased duplicate — must NOT double-count
      May26: "6,129.00",
      Dec25: "3,360.00",
    });
    expect(cells).toHaveLength(3);
    const byMonth = new Map(cells.map((c) => [c.competencia, c.value]));
    expect(byMonth.get("2026-06-01")).toBe(6663);
    expect(byMonth.get("2026-05-01")).toBe(6129);
    expect(byMonth.get("2025-07-01")).toBe(3178);
    expect(cells.every((c) => c.kind === "billed")).toBe(true);
  });
});

describe("dedupe keys", () => {
  it("builds the scraper invoice keys", () => {
    expect(enelChargeDedupeKey("204497514", "2026-06-22")).toBe(
      "enel:204497514:2026-06-22",
    );
    expect(edpChargeDedupeKey("150400460", "2026-05-26")).toBe(
      "edp:150400460:2026-05-26",
    );
    expect(enelChargeDedupeKey("123", null)).toBe("enel:123:na");
  });

  it("builds 2_Pagamentos keys including the unidentified fallback", () => {
    expect(pagamentosChargeDedupeKey(108, "2026-05-01", "aluguel")).toBe(
      "pag:108:2026-05:aluguel",
    );
    expect(pagamentosChargeDedupeKey(null, "2026-05-01", "energia")).toBe(
      "pag:unidentified:2026-05:energia",
    );
    expect(pagamentosChargeDedupeKey(1, null, "aluguel")).toBe(
      "pag:1:na:aluguel",
    );
  });
});

describe("misc cell parsers", () => {
  it("splits multi-installation lists and zips them positionally", () => {
    expect(splitMultiValue("204454589, 204543107, 204767183")).toEqual([
      "204454589",
      "204543107",
      "204767183",
    ]);
    const zipped = zipInstallations({
      installation_id: "48168513, 203886607",
      provider: "Enel, Enel",
      has_auto_debit: "Não cadastrado, Cadastrado",
    });
    expect(zipped.lengthMismatch).toBe(false);
    expect(zipped.installations).toEqual([
      { installationId: "48168513", provider: "enel", autoDebit: "nao_cadastrado" },
      { installationId: "203886607", provider: "enel", autoDebit: "cadastrado" },
    ]);
  });

  it("flags zip length mismatches", () => {
    const zipped = zipInstallations({
      installation_id: "1, 2, 3",
      provider: "Enel, EDP",
      has_auto_debit: "Cadastrado",
    });
    expect(zipped.lengthMismatch).toBe(true);
    expect(zipped.installations).toHaveLength(3);
    // single auto-debit value applies to every installation
    expect(zipped.installations[2].autoDebit).toBe("cadastrado");
  });

  it("extracts the URL from =HYPERLINK with ';' or ',' separators", () => {
    expect(
      extractHyperlinkUrl(
        '=HYPERLINK("https://drive.google.com/file/d/abc/view";"Ver Fatura")',
      ),
    ).toBe("https://drive.google.com/file/d/abc/view");
    expect(
      extractHyperlinkUrl(
        '=HYPERLINK("https://drive.google.com/file/d/xyz/view","Ver Fatura")',
      ),
    ).toBe("https://drive.google.com/file/d/xyz/view");
    expect(extractHyperlinkUrl("Ver Fatura")).toBeNull();
    expect(extractHyperlinkUrl("https://example.com/f.pdf")).toBe(
      "https://example.com/f.pdf",
    );
  });

  it("parses shutdown cells into date + window", () => {
    expect(parseShutdown("2026-07-12 10:00 16:00")).toEqual({
      date: "2026-07-12",
      start: "10:00",
      end: "16:00",
    });
    expect(parseShutdown("")).toEqual({ date: null, start: null, end: null });
  });

  it("parses TRUE/FALSE checkboxes and comprovante leading dates", () => {
    expect(parseBoolean("TRUE")).toBe(true);
    expect(parseBoolean("FALSE")).toBe(false);
    expect(parseBoolean("")).toBeNull();
    expect(
      extractLeadingIsoDate("2026-07-03 - Page 1 - Comprovante DA - Julho.pdf"),
    ).toBe("2026-07-03");
    expect(extractLeadingIsoDate("Não Atualizado")).toBeNull();
  });
});
