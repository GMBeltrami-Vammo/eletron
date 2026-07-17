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

describe("parseComprovantePages — startPage offset (chunked slices)", () => {
  it("labels page_number as startPage + index, not the 1-based array index", () => {
    // a chunk covering document pages 11–12 (a 2-page slice)
    const receipts = parseComprovantePages([PIX_PAGE, TED_PAGE], 11);
    expect(receipts.map((r) => r.pageNumber)).toEqual([11, 12]);
  });
  it("defaults to page 1 for a whole-document call", () => {
    const [r] = parseComprovantePages([PIX_PAGE]);
    expect(r.pageNumber).toBe(1);
  });
  it("keeps multi-segment page numbers correct under an offset", () => {
    const receipts = parseComprovantePages([DEBITO_AUTOMATICO_PAGE], 41);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.pageNumber === 41)).toBe(true);
    expect(receipts.map((r) => r.segmentIndex)).toEqual([0, 1]);
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

// Itaú PIX layout with a bank-MASKED recebedor CNPJ and NO chave (the real
// 05.06 rent comprovante, page 6). The pagador block precedes "dados do
// recebedor"; the OLD parser leaked the pagador's "0742/22501" as the key.
const MASKED_RECEBEDOR_PIX_PAGE = `Comprovante de Transferência
dados do pagador
nome do pagador: VAMMO S A
CPF / CNPJ do pagador: 47.418.909/0001-28
agência/conta: 0742/22501 - 4
dados do recebedor
nome do recebedor: INSTITUTO RESPONSA
CPF / CNPJ do recebedor: *****435000-**
instituição: ITAU UNIBANCO S A
agência/conta: 0444/41193-8
tipo de conta: Conta Corrente
dados da transação
valor: R$ 22.026,23
data da transferência: 05/06/2026
tipo de pagamento: PIX TRANSFERENCIA`;

describe("parseComprovantePages — PIX with masked recebedor CNPJ (Itaú)", () => {
  const [r] = parseComprovantePages([MASKED_RECEBEDOR_PIX_PAGE]);
  it("reads the RECEBEDOR's agência/conta, never the pagador's", () => {
    expect(r.agencia).toBe("0444");
    expect(r.conta).toBe("411938");
    // regression guard: the pagador's account must NOT leak through
    expect(r.conta).not.toBe("225014");
    expect(r.amount).toBeCloseTo(22026.23);
  });
  it("treats the masked CNPJ as null (never a partial that false-matches)", () => {
    expect(r.cnpjCpf).toBeNull();
  });
});

// Hardening (review findings): the conta capture must not bleed onto a following
// bare-numeric line, and the CNPJ capture must not be corrupted by trailing
// same-line content.
describe("parseComprovantePages — receiver extraction hardening", () => {
  it("does not bleed the conta across a following numeric line", () => {
    const page = `Comprovante de Transferência
dados do pagador
agência/conta: 0742/22501 - 4
dados do recebedor
nome do recebedor: FULANO LTDA
CPF / CNPJ do recebedor: 11.222.333/0001-44
agência/conta: 0444/41193-8
00123456789
valor: R$ 100,00
data da transferência: 05/06/2026
tipo de pagamento: PIX TRANSFERENCIA`;
    const [r] = parseComprovantePages([page]);
    expect(r.agencia).toBe("0444");
    expect(r.conta).toBe("411938");
    expect(r.cnpjCpf).toBe("11222333000144");
  });

  it("captures a clean CNPJ even with trailing content on the same line", () => {
    const page = `Comprovante de Transferência
dados do recebedor
CPF / CNPJ do recebedor: 11.222.333/0001-44 ref 999
valor: R$ 100,00
data da transferência: 05/06/2026
tipo de pagamento: PIX TRANSFERENCIA`;
    const [r] = parseComprovantePages([page]);
    expect(r.cnpjCpf).toBe("11222333000144");
  });
});

// Itaú PIX with a phone chave AND a masked CNPJ (page 9 — this one matched
// because the chave carried the key). Confirms the chave survives + masked → null.
const PIX_CHAVE_MASKED_PAGE = `Comprovante de Transferência
dados do pagador
nome do pagador: MATRIZ 1
CPF / CNPJ do pagador: 47.418.909/0001-28
agência/conta: 0742/22501 - 4
dados do recebedor
nome do recebedor: ZERO GRAU MOTO BIKE PECAS
chave: +5511947379316
CPF / CNPJ do recebedor: *****912000-**
instituição: ITAU UNIBANCO S A
dados da transação
valor: R$ 6.000,00
data da transferência: 05/06/2026
tipo de pagamento: PIX TRANSFERENCIA`;

describe("parseComprovantePages — PIX with chave + masked CNPJ", () => {
  const [r] = parseComprovantePages([PIX_CHAVE_MASKED_PAGE]);
  it("keeps the phone chave and ignores the masked CNPJ", () => {
    expect(r.chavePix).toBe("+5511947379316");
    expect(r.cnpjCpf).toBeNull();
    expect(r.amount).toBeCloseTo(6000);
  });
});

// Itaú Sispag TED "Conta Corrente para Conta Corrente" (05.06 comprovante,
// p47-like): the date is DOT-separated ("realizada em 05.06.2026") and there is
// no "dados do recebedor" marker — the creditada section carries the keys.
const TED_CONTA_CORRENTE_PAGE = `Comprovante de Operação - Transferência de Conta Corrente para Conta Corrente
Identificação no Extrato: 00000000000000029329
Dados da conta a ser debitada:
Agência: 0742 Conta: 22501 - 4
Nome: VAMMO S A
Dados da conta a ser creditada:
Agência: 1553 Conta: 99610 - 7
Nome: R A L PARK ESTACIONAMENTO LTDA
Valor: R$ 1.249,68
Informações fornecidas pelo
pagador:
Transferência realizada em 05.06.2026 às 15:45:10, via Sispag, CTRL 008767179260000
Autenticação:
472ABC`;

describe("parseComprovantePages — TED conta-corrente (data com pontos)", () => {
  const [r] = parseComprovantePages([TED_CONTA_CORRENTE_PAGE]);
  it("extracts the dot-separated payment date (pins the competência)", () => {
    expect(r.paidAt).toBe("2026-06-05");
    expect(r.amount).toBeCloseTo(1249.68);
  });
  it("reads the CREDITADA section's agência/conta, not the debitada's", () => {
    expect(r.agencia).toBe("1553");
    expect(r.conta).toBe("996107");
  });
});

// Itaú "TED C – outra titularidade" (julho, p2 real): título sem linha de tipo,
// "Dados da TED:" como seção do favorecido e "Valor da TED:". O parser antigo
// lia amount=null e vazava a agência/conta do PAGADOR (0742/22501-4).
const TED_C_OUTRA_TITULARIDADE_PAGE = `Banco Itaú - Comprovante de Pagamento
TED C – outra titularidade
Identificação no extrato: 00000000000000030363
Dados da conta debitada:
Nome: VAMMO S A
Agência: 0742 Conta corrente: 22501 - 4
Dados da TED:
Nome do favorecido: ELIAS LEAL DE MIRANDA
CPF/CNPJ: 00070645337153
Número do banco, nome e ISPB: 260 - NU PAGAMENTOS - IP - ISPB 18236120
Agência: 0001
Conta corrente: 0000999344606
Valor da TED: R$ 900,00
Finalidade: Credito em conta corrente
Informações fornecidas pelo pagador:
Controle: 001346125661125
TED solicitada em 07/07/2026 às 16:45:39 via Sispag.
Autenticação:
47265FEB8DEAA35F905D721CF09A123056914743`;

describe("parseComprovantePages — TED C outra titularidade (julho)", () => {
  const [r] = parseComprovantePages([TED_C_OUTRA_TITULARIDADE_PAGE]);
  it("lê o Valor da TED e classifica como TED", () => {
    expect(r.amount).toBeCloseTo(900);
    expect(r.receiptType).toBe("ted");
    expect(r.paidAt).toBe("2026-07-07");
  });
  it("lê a agência/conta do FAVORECIDO (seção Dados da TED), nunca a do pagador", () => {
    expect(r.agencia).toBe("0001");
    expect(r.conta).toBe("0000999344606");
    expect(r.conta).not.toBe("225014");
    expect(r.cnpjCpf).toBe("00070645337153");
  });
});

// Itaú CC→CC (julho, p40 real): "Dados da conta creditada:" SEM o "a ser" do
// layout de junho. O parser antigo vazava a agência do pagador.
const TED_CC_JULHO_PAGE = `Banco Itaú - Comprovante de Transferência
de conta corrente para conta corrente
Identificação no extrato: 00000000000000030423
Dados da conta debitada:
Nome da empresa: VAMMO S A
Agência: 0742 Conta corrente: 22501 - 4
Dados da conta creditada:
Nome: AUTO POSTO ESTRELA DAS NACOES
Agência: 8324 Conta corrente: 01639 - 6
Valor: R$ 750,00
Informações fornecidas pelo
pagador:
Transferência efetuada em 07/07/2026 às 16:45:35 via Sispag, CTRL 000779667090000.
Autenticação:
E0A8226F1A3CC5BDAF83FA00837C051390569F6E`;

describe("parseComprovantePages — TED conta-corrente julho (creditada sem 'a ser')", () => {
  const [r] = parseComprovantePages([TED_CC_JULHO_PAGE]);
  it("lê a agência/conta da conta CREDITADA", () => {
    expect(r.amount).toBeCloseTo(750);
    expect(r.agencia).toBe("8324");
    expect(r.conta).toBe("016396");
    expect(r.agencia).not.toBe("0742");
    expect(r.paidAt).toBe("2026-07-07");
  });
});

describe("parseComprovantePages — página sem seção creditada nem recebedor", () => {
  it("NUNCA vaza a agência/conta do pagador como chave", () => {
    const page = `Comprovante de pagamento qualquer
Dados da conta debitada:
Nome: VAMMO S A
Agência: 0742 Conta corrente: 22501 - 4
Valor: R$ 100,00
Pagamento efetuado em 07/07/2026`;
    const [r] = parseComprovantePages([page]);
    expect(r.agencia).toBeNull();
    expect(r.conta).toBeNull();
  });
});

// "Comprovante de Operação - Títulos Outros Bancos" (page 1 of the 05.06
// comprovante). The old parser read "Valor pago:" as amount=null → type "outro".
const TITULOS_PAGE = `Comprovante de Operação - Títulos Outros Bancos
Identificação no Extrato: PAG. TIT. BANCO 237
Dados da conta a ser debitada:
Agência: 0742 Conta: 22501 - 4
Nome: VAMMO S A
Dados do pagamento:
CPF/CNPJ: 92693118000160
Nome do favorecido: BRADESCO SAUDE S A
CPF/CNPJ do pagador: 47.418.909/0001-28
Representação numérica
do código de barras: 23790 00108 52070 048559 02026 538609 7 14680028401202
Valor pago: R$ 284.012,02
Data de vencimento: 05/06/2026
Pagamento efetuado em 05.06.2026 às 15:47:19, via Sispag, CTRL 003217806852395
Autenticação:
44A3DE1B8BE42653F67F6C53F07A1DBBECD8B331`;

describe("parseComprovantePages — título payment (Comprovante de Operação - Títulos)", () => {
  const [r] = parseComprovantePages([TITULOS_PAGE]);
  it("parses a título page as a barcode-linked receipt with the favorecido CNPJ", () => {
    expect(parseComprovantePages([TITULOS_PAGE])).toHaveLength(1);
    expect(r.receiptType).toBe("boleto_barcode");
    expect(r.amount).toBeCloseTo(284012.02);
    // favorecido CNPJ (before "Nome do favorecido"), NOT the pagador's
    expect(r.cnpjCpf).toBe("92693118000160");
    expect(r.codigoBarras).toBe("23790001085207004855902026538609714680028401202");
    expect(r.codigoBarras).toHaveLength(47);
    expect(r.utility).toBeNull();
    expect(r.paidAt).toBe("2026-06-05");
  });
  it("is NOT mis-routed to PIX/TED (amount is not null)", () => {
    expect(r.amount).not.toBeNull();
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

// A "Comprovante de Operação - Tributos Municipais" (pg 45 of 10.07) — same
// barcode + "Valor pago" layout as Títulos; without the branch the PIX/TED
// parser read amount=null + a garbage banco (Gabriel 2026-07-14).
const TRIBUTOS_PAGE = [
  "Comprovante de Operação - Tributos Municipais",
  "Identificação no Extrato:",
  "Dados da conta a ser debitada:",
  "Agência: 0742 Conta: 22501 - 4",
  "Nome: VAMMO",
  "Dados do pagamento:",
  "Representação numérica",
  "do código de barras: 818200000202 005957012609 710020055775 066300299888",
  "Valor pago: R$ 2.000,59",
  "Pagamento efetuado em 10.07.2026 às 13:00:13, via Sispag, CTRL 002026071023155",
  "Autenticação:",
  "43194F3D1A06498605FF96E620F8265A3E330849",
].join("\n");

describe("parseComprovantePages — tributos municipais (Operação, barcode layout)", () => {
  const [r] = parseComprovantePages([TRIBUTOS_PAGE], 45);
  it("reads it as a boleto_barcode with the value + barcode (not amount=null)", () => {
    expect(r.receiptType).toBe("boleto_barcode");
    expect(r.amount).toBe(2000.59);
    expect(r.codigoBarras).toBe("818200000202005957012609710020055775066300299888");
    expect(r.paidAt).toBe("2026-07-10");
    expect(r.banco).toBeNull();
  });
});
