/**
 * Comprovante text parser — faithful port of the n8n `PDF_Comprovante_Processor`
 * workflow (context/PDF_Comprovante_Processor.json). Pure + test-importable
 * (no `server-only`, no I/O): takes per-page text (from unpdf, extract.ts) and
 * returns one `ParsedReceipt` per PIX/TED page, one per débito-automático
 * segment, and one per "Comprovante de Operação - Concessionárias / 0048 -
 * ELETROPAULO" segment (Format C — bank-generated bill-payment receipts).
 *
 * The regexes are copied verbatim from the n8n code nodes so the DB pipeline
 * agrees with the legacy sheet flow on real receipts (D1 acceptance gate).
 * Branch dispatch (review-resolutions / drive-comprovantes §4.2): a page whose
 * text matches the débito-automático header → branch 2; the concessionária /
 * ELETROPAULO header → branch 3; else branch 1 (PIX/TED).
 */

import { RECEIPT_TYPE, type ReceiptType } from "@/lib/domain";
import { normalizePixKey } from "./normalize-pix";
import type { ParsedReceipt, ReceiptUtility } from "./types";

// ── débito-automático header / footer (branch-2 dispatch + segmentation) ────
const DA_HEADER_RE = /comprovante de pagamento de d[eé]bito autom[aá]tico/i;
const DA_FOOTER_RE = /Em caso de d[uú]vidas/i;

// ── concessionária / ELETROPAULO header (branch-3 dispatch + segmentation) ───
// Faithful port of the n8n "Split PDF into Pages2" node: a bank-generated
// "Comprovante de Operação - Concessionárias / 0048 - ELETROPAULO" bill-payment
// receipt, which the PIX/TED branch reads as amount=null. The header both
// selects the branch and splits a bundle page; a receipt body may be cut at
// "cortar aqui". No `g` flag (unlike n8n's exec-loop) so `.test()` stays
// stateless — `.split()` behaves the same with or without it.
const CONCESSIONARIA_HEADER_RE =
  /Comprovante de Opera[çc][aã]o\s*-\s*Concession[áa]rias\s*\n?\s*0048\s*-\s*ELETROPAULO/i;
const CONCESSIONARIA_CUT_RE = /cortar aqui/i;

// ═══════════════════════════════════════════════════════════════════════════
// pt-BR money / date helpers (ported from n8n parseValorBR + date logic)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `'1.042,29' → 1042.29`. Port of n8n `parseValorBR`: strips `R$`/spaces, then
 * uses the LAST separator as the decimal (mixed US/BR safe). Null on failure.
 */
export function parseBrMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[R$\s]/g, "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(".") > s.lastIndexOf(",")) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(/\./g, "").replace(",", ".");
    }
  } else {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function isoFrom(day: string, month: string, year: string): string {
  const y = year.length === 2 ? `20${year}` : year;
  return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * `'DD/MM/YYYY'`, `'DD-MM-YY'`, or already-ISO `'YYYY-MM-DD'` → ISO. Null when
 * it does not parse.
 */
export function parseBrDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) return isoFrom(m[1], m[2], m[3]);
  return null;
}

/** n8n branch-1 date patterns (labeled + bare, 4- and 2-digit year). */
function extractPixDate(text: string): string | null {
  const patterns: RegExp[] = [
    /(?:Data\s*de\s*Transfer[êe]ncia|Data)\s*:?\s*(\d{2})[/-](\d{2})[/-](\d{4})/i,
    /(?:Data\s*de\s*Transfer[êe]ncia|Data)\s*:?\s*(\d{2})[/-](\d{2})[/-](\d{2})/i,
    /(\d{2})[/-](\d{2})[/-](\d{4})/,
    /(\d{2})[/-](\d{2})[/-](\d{2})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return isoFrom(m[1], m[2], m[3]);
  }
  return null;
}

function digits(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

function receiptTypeFromTipo(tipo: string): ReceiptType {
  const up = tipo.toUpperCase();
  if (up.includes("PIX")) return RECEIPT_TYPE.pix;
  if (up.includes("TRANSFER")) return RECEIPT_TYPE.ted;
  return RECEIPT_TYPE.outro;
}

// ═══════════════════════════════════════════════════════════════════════════
// Branch 1 — PIX / TED (one receipt per page)
// ═══════════════════════════════════════════════════════════════════════════

/** n8n chave patterns, first match wins (label → email → phone → CPF → CNPJ → UUID). */
function extractChave(text: string): string | null {
  const patterns: RegExp[] = [
    /Chave(?:\s*PIX)?\s*:?\s*([^\n\r]+)/i,
    /([\w.]+@[\w.]+)/,
    /\b(\+55\d{10,11})\b/,
    /\b(\d{11})\b/,
    /\b(\d{14})\b/,
    /\b([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** n8n "Extract CNPJ as Chave" fallback — CNPJ do recebedor / pre-Pagador / agência-conta. */
function extractCnpjFallback(pageText: string): string | null {
  const m1 = pageText.match(
    /CNPJ\s*do\s*[Rr]ecebedor\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i,
  );
  if (m1) return m1[1].replace(/\D/g, "");
  const pagadorIdx = pageText.search(/(?:Pagador|Ordenante|Remetente)/i);
  const before = pagadorIdx > -1 ? pageText.substring(0, pagadorIdx) : pageText;
  const m2 = before.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  if (m2) return m2[1].replace(/\D/g, "");
  return null;
}

/** n8n "Get TED values" — credited-account section: agência / conta / banco / CPF-CNPJ. */
function extractTedFields(pageText: string): {
  agencia: string | null;
  conta: string | null;
  banco: string | null;
  cnpjCpf: string | null;
} {
  const sectionMatch = pageText.match(
    /Dados da conta a ser creditada:([\s\S]*?)(?:Informa[çc][õo]es fornecidas|Transfer[êe]ncia realizada|Autentica[çc][ãa]o)/i,
  );
  const section = sectionMatch ? sectionMatch[1] : pageText;

  const agencia = digits(section.match(/Ag[eê]ncia\s*:?\s*([\d-]+)/i)?.[1] ?? null);
  const contaRaw =
    section.match(/Conta\s*corrente\s*:?\s*([0-9\s-]+)/i)?.[1] ??
    section.match(/Conta\s*:?\s*([0-9\s-]+)/i)?.[1] ??
    null;
  const conta = digits(contaRaw);
  const bancoMatch = section.match(/(\d{3})\s*-\s*([^\n]+)/);
  const banco = bancoMatch ? `${bancoMatch[1]} - ${bancoMatch[2].trim()}` : null;
  const agConta = pageText.match(/ag[eê]ncia\/conta\s*:?\s*([\d/\-.]+)/i)?.[1] ?? null;
  const cnpjCpf =
    digits(section.match(/CPF\/CNPJ\s*:?\s*([\d.\-/]+)/i)?.[1] ?? null) ??
    extractCnpjFallback(pageText) ??
    digits(agConta);

  return { agencia, conta, banco, cnpjCpf };
}

function parsePixTedPage(pageText: string, pageNumber: number): ParsedReceipt {
  // n8n anchors extraction at "dados do recebedor" when present.
  const markerIdx = pageText.search(/dados\s*do\s*recebedor/i);
  const text = markerIdx !== -1 ? pageText.substring(markerIdx) : pageText;

  let tipo = "";
  const tipoMatch = text.match(
    /(?:Tipo|Forma)\s*(?:de)?\s*(?:Pagamento|Transa[çc][ãa]o)\s*:?\s*([A-ZÀ-Úa-zà-ú\s]+)/i,
  );
  if (tipoMatch) tipo = tipoMatch[1].trim();
  else if (/PIX/i.test(text)) tipo = "PIX";
  else if (/TRANSFER[ÊE]NCIA|TRANSFERENCIA/i.test(text)) tipo = "TRANSFERENCIA";

  const valorMatch = text.match(/(?:Valor|Total|Quantia)\s*:?\s*R?\$?\s*([\d.,]+)/i);
  const amount = parseBrMoney(valorMatch?.[1] ?? null);

  const chave = extractChave(text);
  const chavePixNormalized = chave ? normalizePixKey(chave).key || null : null;
  const paidAt = extractPixDate(text);

  const ted = extractTedFields(pageText);
  // If the chave itself is a bare document, expose it for CNPJ matching too.
  const chaveDigits = chave ? chave.replace(/\D/g, "") : "";
  const cnpjFromChave =
    chaveDigits.length === 14 || chaveDigits.length === 11 ? chaveDigits : null;

  return {
    pageNumber,
    segmentIndex: 0,
    receiptType: receiptTypeFromTipo(tipo),
    amount,
    paidAt,
    chavePix: chave,
    chavePixNormalized,
    cnpjCpf: ted.cnpjCpf ?? cnpjFromChave,
    banco: ted.banco,
    agencia: ted.agencia,
    conta: ted.conta,
    identificacao: null,
    autenticacao: null,
    codigoBarras: null,
    ctrl: null,
    utility: null,
    rawText: pageText,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Branch 2 — débito automático (one receipt per segment on a page)
// ═══════════════════════════════════════════════════════════════════════════

function utilityFromIdentificacao(identificacao: string): ReceiptUtility | null {
  const up = identificacao.toUpperCase();
  if (up.includes("DA ELETROPAULO")) return "enel";
  if (up.includes("DA EDP")) return "edp";
  return null;
}

function parseDebitoAutomaticoPage(
  pageText: string,
  pageNumber: number,
): ParsedReceipt[] {
  const segments = pageText
    .split(DA_HEADER_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: ParsedReceipt[] = [];
  segments.forEach((segment, segIndex) => {
    const body = segment.split(DA_FOOTER_RE)[0].trim();
    if (!body) return;

    const valor = body.match(/valor\s+R\$\s*([\d.,]+)/i)?.[1] ?? null;
    const identificacao =
      body.match(/Identifica[çc][aã]o no extrato\s+(.+)/i)?.[1]?.trim() ?? null;
    const data = body.match(/pagamento realizado em\s+([\d/]+)/i)?.[1] ?? null;
    const autenticacao =
      body.match(/autentica[çc][aã]o\s+([A-F0-9]+)/i)?.[1] ?? null;
    const ctrl = body.match(/CTRL\s+(\d+)/i)?.[1] ?? null;

    // Drop garbage split fragments that carry neither a value nor a label.
    if (valor === null && identificacao === null) return;

    const codigoBarras = identificacao?.match(/(\d+)$/)?.[1] ?? null;

    out.push({
      pageNumber,
      segmentIndex: segIndex,
      receiptType: RECEIPT_TYPE.debitoAutomatico,
      amount: parseBrMoney(valor),
      paidAt: parseBrDate(data),
      chavePix: null,
      chavePixNormalized: null,
      cnpjCpf: null,
      banco: null,
      agencia: null,
      conta: null,
      identificacao,
      autenticacao,
      codigoBarras,
      ctrl,
      utility: identificacao ? utilityFromIdentificacao(identificacao) : null,
      rawText: body,
    });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Branch 3 — concessionária / ELETROPAULO (one receipt per segment on a page)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Port of n8n "Split PDF into Pages2". A page carrying one or more concessionária
 * receipts is split on the header (segment_index), each body cut at "cortar
 * aqui". Modeled as a `boleto_barcode` receipt: it links off the barcode / linha
 * digitável (the matcher's rank-1 key), utility is always Enel (0048 =
 * ELETROPAULO). The barcode is stored digits-only so the ranked matcher's
 * `codigo_barras` rank compares it against `charges.linha_digitavel`.
 */
function parseConcessionariaPage(
  pageText: string,
  pageNumber: number,
): ParsedReceipt[] {
  const segments = pageText
    .split(CONCESSIONARIA_HEADER_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: ParsedReceipt[] = [];
  segments.forEach((segment, segIndex) => {
    const body = segment.split(CONCESSIONARIA_CUT_RE)[0].trim();
    if (!body) return;

    const valor = body.match(/Valor pago[:\s]*R\$\s*([\d.,]+)/i)?.[1] ?? null;
    const codigoBarras =
      digits(body.match(/c[oó]digo de barras[:\s]*([\d\s]+)/i)?.[1] ?? null);
    const ctrl = body.match(/CTRL\s+(\d+)/i)?.[1] ?? null;
    const dataRaw =
      body.match(/Pagamento efetuado em\s+([\d.]+)\s+[àa]s\s+([\d:]+)/i)?.[1] ??
      null;
    const autenticacao =
      body.match(/Autentica[çc][aã]o[:\s]*\n?\s*([A-F0-9]{32,})/i)?.[1]?.trim() ??
      null;

    const amount = parseBrMoney(valor);

    // n8n drops fragments that carry neither a value nor a barcode.
    if (amount === null && codigoBarras === null) return;

    out.push({
      pageNumber,
      segmentIndex: segIndex,
      receiptType: RECEIPT_TYPE.boletoBarcode,
      amount,
      paidAt: parseBrDate(dataRaw),
      chavePix: null,
      chavePixNormalized: null,
      cnpjCpf: null,
      banco: null,
      agencia: null,
      conta: null,
      identificacao: null,
      autenticacao,
      codigoBarras,
      ctrl,
      utility: "enel",
      rawText: body,
    });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses per-page comprovante text into receipts. Débito-automático and
 * concessionária / ELETROPAULO pages yield one receipt per segment; every other
 * non-empty page yields exactly one PIX/TED receipt.
 */
export function parseComprovantePages(pages: string[]): ParsedReceipt[] {
  const receipts: ParsedReceipt[] = [];
  pages.forEach((raw, i) => {
    const pageNumber = i + 1;
    const pageText = raw ?? "";
    if (DA_HEADER_RE.test(pageText)) {
      receipts.push(...parseDebitoAutomaticoPage(pageText, pageNumber));
    } else if (CONCESSIONARIA_HEADER_RE.test(pageText)) {
      receipts.push(...parseConcessionariaPage(pageText, pageNumber));
    } else if (pageText.trim().length > 0) {
      receipts.push(parsePixTedPage(pageText, pageNumber));
    }
  });
  return receipts;
}
