import { describe, expect, it } from "vitest";

import { parseBrDate, parseBrMoney, parseComprovantePages } from "./parse";

describe("parseBrMoney", () => {
  it("parses pt-BR money (last separator is the decimal)", () => {
    expect(parseBrMoney("1.042,29")).toBeCloseTo(1042.29);
    expect(parseBrMoney("150,00")).toBeCloseTo(150);
    expect(parseBrMoney("R$ 90,50")).toBeCloseTo(90.5);
  });
  it("parses US-style mixed separators", () => {
    expect(parseBrMoney("1,042.29")).toBeCloseTo(1042.29);
  });
  it("returns null for empty/garbage", () => {
    expect(parseBrMoney("")).toBeNull();
    expect(parseBrMoney(null)).toBeNull();
  });
});

describe("parseBrDate", () => {
  it("parses DD/MM/YYYY and DD/MM/YY", () => {
    expect(parseBrDate("20/05/2026")).toBe("2026-05-20");
    expect(parseBrDate("05/06/26")).toBe("2026-06-05");
  });
  it("passes ISO through and rejects garbage", () => {
    expect(parseBrDate("2026-05-20")).toBe("2026-05-20");
    expect(parseBrDate("não é data")).toBeNull();
  });
});

const PIX_PAGE = `Dados do recebedor
Tipo de Pagamento: PIX
Valor: R$ 1.042,29
Chave PIX: financeiro@fornecedor.com
Data de Transferência: 28/05/2026`;

const TED_PAGE = `Comprovante de Transferência
Tipo de Pagamento: TRANSFERENCIA
Valor: R$ 500,00
Dados da conta a ser creditada:
Banco: 341 - Itau Unibanco
Agência: 1234
Conta corrente: 56789-0
CPF/CNPJ: 12.345.678/0001-99
Transferência realizada em 03/06/2026`;

const DEBITO_AUTOMATICO_PAGE = `Comprovante de pagamento de débito automático
valor R$ 250,00
Identificação no extrato DA ELETROPAULO 123456789
pagamento realizado em 05/05/2026
autenticação ABC123DEF456
Em caso de dúvidas entre em contato
Comprovante de pagamento de débito automático
valor R$ 88,90
Identificação no extrato DA EDP 987654
pagamento realizado em 06/05/2026
autenticação 9988AA
Em caso de dúvidas entre em contato`;

describe("parseComprovantePages — PIX", () => {
  const [r] = parseComprovantePages([PIX_PAGE]);
  it("extracts a single PIX receipt", () => {
    expect(r.receiptType).toBe("pix");
    expect(r.amount).toBeCloseTo(1042.29);
    expect(r.chavePix).toBe("financeiro@fornecedor.com");
    expect(r.chavePixNormalized).toBe("financeiro@fornecedorcom");
    expect(r.paidAt).toBe("2026-05-28");
    expect(r.pageNumber).toBe(1);
    expect(r.segmentIndex).toBe(0);
  });
});

describe("parseComprovantePages — TED", () => {
  const [r] = parseComprovantePages([TED_PAGE]);
  it("extracts a transferência with agência/conta/CNPJ", () => {
    expect(r.receiptType).toBe("ted");
    expect(r.amount).toBeCloseTo(500);
    expect(r.agencia).toBe("1234");
    expect(r.conta).toBe("567890");
    expect(r.cnpjCpf).toBe("12345678000199");
    expect(r.banco).toContain("341");
    expect(r.paidAt).toBe("2026-06-03");
    expect(r.chavePix).toBeNull();
  });
});

describe("parseComprovantePages — débito automático (multi-segment)", () => {
  const receipts = parseComprovantePages([DEBITO_AUTOMATICO_PAGE]);
  it("splits one page into one receipt per segment", () => {
    expect(receipts).toHaveLength(2);
  });
  it("routes ELETROPAULO → enel with the trailing code as codigoBarras", () => {
    const enel = receipts[0];
    expect(enel.receiptType).toBe("debito_automatico");
    expect(enel.utility).toBe("enel");
    expect(enel.codigoBarras).toBe("123456789");
    expect(enel.amount).toBeCloseTo(250);
    expect(enel.paidAt).toBe("2026-05-05");
    expect(enel.autenticacao).toBe("ABC123DEF456");
    expect(enel.segmentIndex).toBe(0);
  });
  it("routes EDP → edp on the second segment", () => {
    const edp = receipts[1];
    expect(edp.utility).toBe("edp");
    expect(edp.codigoBarras).toBe("987654");
    expect(edp.amount).toBeCloseTo(88.9);
    expect(edp.paidAt).toBe("2026-05-06");
    expect(edp.segmentIndex).toBe(1);
  });
});

/**
 * Real-PDF acceptance gate (D1 / drive-comprovantes §4.2) — DEFERRED until
 * Gabriel provides redacted fixtures. Drop ≥1 PDF per branch under
 * `context/comprovante-fixtures/`, extract via `extractPdfText`, then assert the
 * parser output equals the legacy n8n `PDF_Comprovante_Processor` output.
 */
describe.skip("real-PDF acceptance gate (needs redacted fixtures)", () => {
  it("matches n8n output on PIX/TED, débito-automático, ELETROPAULO/EDP", () => {
    expect(true).toBe(true);
  });
});
