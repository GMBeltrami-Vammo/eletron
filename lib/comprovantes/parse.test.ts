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

const CONCESSIONARIA_BARCODE_1 = "8366 0000 0012 3456 0000";
const CONCESSIONARIA_PAGE = `Comprovante de Operação - Concessionárias
0048 - ELETROPAULO
Valor pago: R$ 1.234,56
código de barras: ${CONCESSIONARIA_BARCODE_1}
CTRL 987654321
Pagamento efetuado em 07.07.2025 às 14:30
Autenticação
A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4
cortar aqui
Comprovante de Operação - Concessionárias
0048 - ELETROPAULO
Valor pago: R$ 90,00
código de barras: 83660000009000000001
CTRL 111222333
Pagamento efetuado em 08.07.2025 às 15:00
Autenticação
ffeeddccbbaa99887766554433221100
cortar aqui`;

describe("parseComprovantePages — concessionária / ELETROPAULO (Format C, multi-segment)", () => {
  const receipts = parseComprovantePages([CONCESSIONARIA_PAGE]);
  it("splits one page into one receipt per concessionária segment", () => {
    expect(receipts).toHaveLength(2);
  });
  it("parses the first receipt as a barcode-linked Enel receipt", () => {
    const [first] = receipts;
    expect(first.receiptType).toBe("boleto_barcode");
    expect(first.utility).toBe("enel");
    expect(first.amount).toBeCloseTo(1234.56);
    expect(first.paidAt).toBe("2025-07-07");
    // barcode stored digits-only (spaces stripped) for the barcode-rank matcher
    expect(first.codigoBarras).toBe(CONCESSIONARIA_BARCODE_1.replace(/\s+/g, ""));
    expect(first.ctrl).toBe("987654321");
    expect(first.autenticacao).toBe("A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4");
    expect(first.chavePix).toBeNull();
    expect(first.segmentIndex).toBe(0);
  });
  it("parses the second segment (lowercase auth hash included)", () => {
    const second = receipts[1];
    expect(second.amount).toBeCloseTo(90);
    expect(second.paidAt).toBe("2025-07-08");
    expect(second.codigoBarras).toBe("83660000009000000001");
    expect(second.autenticacao).toBe("ffeeddccbbaa99887766554433221100");
    expect(second.segmentIndex).toBe(1);
  });
  it("does NOT fall through to the PIX/TED branch (amount is not null)", () => {
    for (const r of receipts) {
      expect(r.amount).not.toBeNull();
      expect(r.codigoBarras).not.toBeNull();
    }
  });
});

// Boleto-payment ("Comprovante de pagamento de boleto") — the Itaú Sispag
// layout from the 07.07 fixtures. Amount is the "Valor do pagamento" line (here
// deliberately ≠ "Valor do boleto" so the test proves precedence); the linha
// digitável carries a bank-name prefix that must be stripped.
const BOLETO_BARCODE_1 = "42297 08302 00000 970582 90048 848429 5 14890011316126";
const BOLETO_PAYMENT_PAGE = `Comprovante de pagamento de boleto
Dados da conta debitada / Pagador Final
Agência/conta: 0742/22501-4 CPF/CNPJ: 47.418.909/0001-28 Empresa: VAMMO S A
Dados do pagamento
Identificação no meu comprovante:
BCO SAFRA S.A. ${BOLETO_BARCODE_1}
Beneficiário: MONTANNA DISTR DE MOTO P LTDA CPF/CNPJ do beneficiário: Data de vencimento:
Razão Social: MONTANNA DISTR DE MOTO P LTD 58.840.448/0001-01 07/07/2026
Valor do boleto (R$);
100,00
(-) Desconto (R$):
0,00
(+)Mora/Multa (R$):
13,16
Pagador: CPF/CNPJ do pagador: (=) Valor do pagamento (R$):
VAMMO S A 47.418.909/0001-28 113,16
Data de pagamento:
07/07/2026
Autenticação mecânica Pagamento realizado em espécie:
DFE254FD8E3D579F2979A8EFFD58594173F96F98 Não
Operação efetuada em 07/07/2026 às 16:51:14 via Sispag, CTRL 003117834538741.
Em caso de dúvidas, de posse do comprovante, contate seu gerente.`;

// The "Beneficiário Final" variant puts the payment date as the LAST token of
// the line after "Data de pagamento:", after a name and a CNPJ.
const BOLETO_PAYMENT_BENEF_FINAL_PAGE = `Comprovante de pagamento de boleto
Dados da conta debitada / Pagador Final
Agência/conta: 0742/22501-4 CPF/CNPJ: 47.418.909/0001-28 Empresa: VAMMO S A
Dados do pagamento
Identificação no meu comprovante:
ASAAS IP S.A. 46191 11000 00000 000042 57695 958017 4 15030003572418
Beneficiário: TRACK SOLUTION RASTREAMENTO VE CPF/CNPJ do beneficiário: Data de vencimento:
Razão Social: TRACK SOLUTION RASTREAMENTO 15.334.710/0001-25 10/07/2026
Valor do boleto (R$);
35.724,18
Pagador: CPF/CNPJ do pagador: (=) Valor do pagamento (R$):
Vammo Ltda 47.418.909/0001-28 35.724,18
Beneficiário Final: CPF/CNPJ do beneficiário final: (=) Data de pagamento:
TRACK SOLUTION RASTREAMENTO VEICULAR LTDA 15.334.710/0001-25 07/07/2026
Autenticação mecânica Pagamento realizado em espécie:
010559CEA85E4486969C672707F75E22B097C6A5 Não
Operação efetuada em 07/07/2026 às 16:45:38 via Sispag, CTRL 008317834535386.
Em caso de dúvidas, de posse do comprovante, contate seu gerente.`;

describe("parseComprovantePages — boleto payment (Comprovante de pagamento de boleto)", () => {
  const [r] = parseComprovantePages([BOLETO_PAYMENT_PAGE]);
  it("parses a boleto-payment page as a barcode-linked receipt (utility null)", () => {
    expect(r.receiptType).toBe("boleto_barcode");
    expect(r.utility).toBeNull();
    // amount is "Valor do pagamento" (113,16), NOT "Valor do boleto" (100,00)
    expect(r.amount).toBeCloseTo(113.16);
    expect(r.paidAt).toBe("2026-07-07");
    // linha digitável: 47 digits, bank-name prefix stripped, digits-only
    expect(r.codigoBarras).toBe(BOLETO_BARCODE_1.replace(/\s+/g, ""));
    expect(r.codigoBarras).toHaveLength(47);
    // issuer = beneficiário CNPJ (Razão Social line), NOT the pagador (Vammo)
    expect(r.cnpjCpf).toBe("58840448000101");
    expect(r.autenticacao).toBe("DFE254FD8E3D579F2979A8EFFD58594173F96F98");
    expect(r.ctrl).toBe("003117834538741");
    expect(r.chavePix).toBeNull();
    expect(r.segmentIndex).toBe(0);
  });
  it("is NOT mis-routed to débito-automático or PIX/TED", () => {
    // a single boleto-payment page yields exactly one receipt with an amount
    expect(parseComprovantePages([BOLETO_PAYMENT_PAGE])).toHaveLength(1);
    expect(r.amount).not.toBeNull();
  });

  it("handles the 'Beneficiário Final' variant (date is the last token on its line)", () => {
    const [benef] = parseComprovantePages([BOLETO_PAYMENT_BENEF_FINAL_PAGE]);
    expect(benef.receiptType).toBe("boleto_barcode");
    // payment date 07/07, NOT the vencimento 10/07 and NOT a CNPJ fragment
    expect(benef.paidAt).toBe("2026-07-07");
    expect(benef.amount).toBeCloseTo(35724.18);
    expect(benef.codigoBarras).toHaveLength(47);
    expect(benef.cnpjCpf).toBe("15334710000125");
  });

  it("segments multiple boleto-payment receipts on one page (segment_index)", () => {
    const receipts = parseComprovantePages([
      `${BOLETO_PAYMENT_PAGE}\n${BOLETO_PAYMENT_BENEF_FINAL_PAGE}`,
    ]);
    expect(receipts).toHaveLength(2);
    expect(receipts[0].segmentIndex).toBe(0);
    expect(receipts[1].segmentIndex).toBe(1);
    expect(receipts[1].amount).toBeCloseTo(35724.18);
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
