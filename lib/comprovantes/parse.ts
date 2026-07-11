/**
 * Comprovante text parser — faithful port of the n8n `PDF_Comprovante_Processor`
 * workflow (context/PDF_Comprovante_Processor.json). Pure + test-importable
 * (no `server-only`, no I/O): takes per-page text (from unpdf, extract.ts) and
 * returns one `ParsedReceipt` per PIX/TED page, one per débito-automático
 * segment, one per "Comprovante de Operação - Concessionárias / 0048 -
 * ELETROPAULO" segment (Format C — bank-generated bill-payment receipts), and
 * one per "Comprovante de pagamento de boleto" segment (branch 4 — the payer's
 * proof of paying a boleto; derived from the 07.07 fixtures, not from n8n).
 *
 * The PIX/TED, débito-automático and concessionária regexes are copied verbatim
 * from the n8n code nodes so the DB pipeline agrees with the legacy sheet flow
 * on real receipts (D1 acceptance gate). The boleto-payment branch has no n8n
 * reference — its regexes were derived from the fixtures.
 * Branch dispatch (review-resolutions / drive-comprovantes §4.2): a page whose
 * text matches the débito-automático header → branch 2; the concessionária /
 * ELETROPAULO header → branch 3; the boleto-payment header → branch 4; else
 * branch 1 (PIX/TED).
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

// ── boleto-payment header (branch-4 dispatch + segmentation) ─────────────────
// A bank-generated "Comprovante de pagamento de boleto" — the payer's proof of
// paying a boleto (Itaú Sispag layout in the 07.07 fixtures). The legacy n8n
// flow does NOT parse it; the PIX/TED branch reads its "Valor" layout as
// amount=null. Distinct from the débito-automático header ("…de débito
// automático") and the concessionária header, so it is dispatched AFTER both —
// the shared "Comprovante de pagamento de …" prefix never collides. The body is
// cut at the shared "Em caso de dúvidas" footer (DA_FOOTER_RE).
const BOLETO_PAYMENT_HEADER_RE = /Comprovante de pagamento de boleto/i;

// ── título-payment header (branch-5 dispatch + segmentation) ─────────────────
// A bank-generated "Comprovante de Operação - Títulos Outros Bancos" — the
// payer's proof of paying a título/boleto via Itaú Sispag (seen in the 05.06
// rent comprovante). Neither n8n nor the PIX/TED branch parses its "Valor pago:"
// layout (→ amount=null, type "outro"). Distinct from the concessionária header
// ("…Concessionárias / 0048 - ELETROPAULO") and the "pagamento de boleto"
// header, so no dispatch collision. Body cut at the "Cortar aqui" separator.
const TITULOS_PAYMENT_HEADER_RE = /Comprovante de Opera[çc][aã]o\s*-\s*T[íi]tulos/i;
const BR_MONEY_RE = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
const BR_DATE_RE = /\d{2}[/.]\d{2}[/.]\d{4}/g;

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

/**
 * n8n branch-1 date patterns (labeled + bare, 4- and 2-digit year), extended
 * with DOT separators — the Itaú Sispag TED layouts print "Transferência
 * realizada em 05.06.2026" (dots), which pins the competência (rule 2).
 */
function extractPixDate(text: string): string | null {
  const patterns: RegExp[] = [
    /(?:Data\s*de\s*Transfer[êe]ncia|Data)\s*:?\s*(\d{2})[/.-](\d{2})[/.-](\d{4})/i,
    /(?:realizad[ao]|efetuad[ao])\s+em\s+(\d{2})[/.-](\d{2})[/.-](\d{4})/i,
    /(?:Data\s*de\s*Transfer[êe]ncia|Data)\s*:?\s*(\d{2})[/.-](\d{2})[/.-](\d{2})\b/i,
    // bare fallbacks: digit-boundary guards so a longer digit run (document
    // numbers, barcode groups) can never be misread as a date fragment.
    /(?<!\d)(\d{2})[/-](\d{2})[/-](\d{4})(?!\d)/,
    /(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/,
    /(?<!\d)(\d{2})[/-](\d{2})[/-](\d{2})(?!\d)/,
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

/**
 * Extracts the RECEBEDOR's agência / conta / banco / CNPJ. Handles the layouts:
 *   - Itaú PIX/TED combined "agência/conta: 0444/41193-8".
 *   - Seção creditada: "Dados da conta a ser creditada:" (Bradesco/TED C junho),
 *     "Dados da conta creditada:" (Itaú CC→CC julho) e "Dados da TED:" (TED C
 *     "outra titularidade" julho) — separate Agência/Conta lines.
 * `scoped` = the caller already cut the text at "dados do recebedor", so a
 * whole-text fallback cannot see the pagador. When NOT scoped and no creditada
 * section exists, agência/conta stay null — the only bare Agência/Conta on such
 * pages is the PAGADOR's (VAMMO), which must never become a matching key.
 * A bank-masked CNPJ ("*****435000-**") or any non-11/14-digit partial yields
 * null — never a garbage key that could false-match.
 */
function extractTedFields(
  text: string,
  scoped: boolean,
): {
  agencia: string | null;
  conta: string | null;
  banco: string | null;
  cnpjCpf: string | null;
} {
  // Itaú combined "agência/conta: 0444/41193-8". The conta class uses a literal
  // space (not \s) so it spans the "22501 - 4" form but never bleeds onto the
  // next line if a bare numeric line follows (review finding).
  const combined = text.match(/ag[eê]ncia\/conta\s*:?\s*(\d+)\s*\/\s*([\d.\- ]+)/i);
  let agencia = combined ? digits(combined[1]) || null : null;
  let conta = combined ? digits(combined[2]) || null : null;

  // Creditada/TED section (separate Agência/Conta lines).
  if (!agencia && !conta) {
    const sectionMatch = text.match(
      /Dados da (?:conta (?:a ser )?creditada|TED)\s*:([\s\S]*?)(?:Informa[çc][õo]es fornecidas|Transfer[êe]ncia (?:realizada|efetuada)|TED solicitada|Autentica[çc][ãa]o)/i,
    );
    const section = sectionMatch ? sectionMatch[1] : scoped ? text : null;
    if (section !== null) {
      agencia = digits(section.match(/Ag[eê]ncia\s*:?\s*([\d-]+)/i)?.[1] ?? null) || null;
      const contaRaw =
        section.match(/Conta\s*corrente\s*:?\s*([0-9\s-]+)/i)?.[1] ??
        section.match(/Conta\s*:?\s*([0-9\s-]+)/i)?.[1] ??
        null;
      conta = digits(contaRaw) || null;
    }
  }

  const instMatch = text.match(/institui[çc][ãa]o\s*:?\s*([^\n]+)/i);
  const bancoMatch = text.match(/(\d{3})\s*-\s*([^\n]+)/);
  const banco = instMatch
    ? instMatch[1].trim()
    : bancoMatch
      ? `${bancoMatch[1]} - ${bancoMatch[2].trim()}`
      : null;

  // Recebedor CNPJ/CPF — prefer the explicit "do recebedor" label, else any
  // "CPF/CNPJ:" that is NOT the pagador's. Masked/partial → null.
  const rawCnpj =
    text.match(/CPF\s*\/?\s*CNPJ\s*do\s*recebedor\s*:?\s*([^\n]+)/i)?.[1] ??
    text.match(/CPF\s*\/?\s*CNPJ(?!\s*do\s*pagador)\s*:?\s*([^\n]+)/i)?.[1] ??
    null;
  let cnpjCpf: string | null = null;
  if (rawCnpj && !rawCnpj.includes("*")) {
    // Take the first doc-shaped token on the line (stops at the first space) so
    // trailing same-line content can't corrupt the digit count. The masked "*"
    // guard above runs on the full line, so masking is still detected first.
    const d = digits(rawCnpj.match(/\d[\d.\-/]*/)?.[0] ?? null);
    if (d && (d.length === 11 || d.length === 14)) cnpjCpf = d;
  }

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
  // Itaú "TED C – outra titularidade" has no tipo line — the title names it.
  else if (/\bTED\b/.test(text)) tipo = "TRANSFERENCIA";

  // "Valor da TED:" / "Valor da transferência:" (qualificador exige o ":"),
  // com o padrão n8n original como fallback (colon opcional) — zero regressão.
  const valorMatch =
    text.match(
      /(?:Valor(?:\s+d[aoe]\s+[A-Za-zÀ-ú]+)?|Total|Quantia)\s*:\s*R?\$?\s*([\d.,]+)/i,
    ) ?? text.match(/(?:Valor|Total|Quantia)\s*:?\s*R?\$?\s*([\d.,]+)/i);
  const amount = parseBrMoney(valorMatch?.[1] ?? null);

  const chave = extractChave(text);
  const chavePixNormalized = chave ? normalizePixKey(chave).key || null : null;
  const paidAt = extractPixDate(text);

  // Scope to the recebedor section so we read the RECEBEDOR's agência/conta/CNPJ,
  // never the pagador's (the pagador block precedes "dados do recebedor").
  const ted = extractTedFields(text, markerIdx !== -1);
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
// Branch 4 — boleto payment (one receipt per segment on a page)
// ═══════════════════════════════════════════════════════════════════════════

/** Last full match of a `/g` regex (null when none). */
function lastOf(matches: RegExpMatchArray | null): string | null {
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Longest space-separated digit run on a line, returned digits-only. The
 * "Identificação no meu comprovante" line reads `<bank name> <47-digit linha
 * digitável, grouped 5 5 5 6 5 6 1 14>`; the bank-name letters break the run, so
 * the linha digitável is the longest run. Stored digits-only so the matcher's
 * rank-1 `codigo_barras` key compares it against `charges.linha_digitavel`.
 */
function longestDigitRun(line: string): string | null {
  const runs = line.match(/\d[\d ]*\d/g);
  if (!runs) return null;
  let best = "";
  for (const r of runs) {
    const d = r.replace(/\D/g, "");
    if (d.length > best.length) best = d;
  }
  return best.length > 0 ? best : null;
}

/**
 * Port-less parser for "Comprovante de pagamento de boleto" pages (branch 4).
 * A page carrying one or more boleto-payment receipts is split on the header
 * (segment_index), each body cut at the "Em caso de dúvidas" footer. Modeled as
 * a `boleto_barcode` receipt: it links off the linha digitável (the matcher's
 * rank-1 key). `utility` is null — the beneficiário is an arbitrary supplier,
 * not necessarily Enel/EDP (that is what separates it from the concessionária
 * branch, which is always Enel). Fields (all derived from the 07.07 fixtures):
 *   - amount   → "(=) Valor do pagamento (R$):", the last money token on the
 *                next line (`<pagador> <CNPJ> <valor>`); fallback "Valor do
 *                boleto (R$);".
 *   - paidAt   → "Data de pagamento:", the last date on the next line (the
 *                "Beneficiário Final" variant prefixes a name + CNPJ).
 *   - barcode  → longest digit run on the "Identificação no meu comprovante" line.
 *   - cnpjCpf  → beneficiário CNPJ on the "Razão Social:" line (issuer key).
 */
function parseBoletoPaymentPage(
  pageText: string,
  pageNumber: number,
): ParsedReceipt[] {
  const segments = pageText
    .split(BOLETO_PAYMENT_HEADER_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: ParsedReceipt[] = [];
  segments.forEach((segment, segIndex) => {
    const body = segment.split(DA_FOOTER_RE)[0].trim();
    if (!body) return;

    const valorLine =
      body.match(/Valor do pagamento \(R\$\):[^\n]*\n([^\n]+)/i)?.[1] ?? "";
    const boletoLine =
      body.match(/Valor do boleto \(R\$\)[;:][^\n]*\n([^\n]+)/i)?.[1] ?? "";
    const valorTok =
      lastOf(valorLine.match(BR_MONEY_RE)) ?? lastOf(boletoLine.match(BR_MONEY_RE));
    const amount = parseBrMoney(valorTok);

    const idLine =
      body.match(/Identifica[çc][aã]o no meu comprovante:[^\n]*\n([^\n]+)/i)?.[1] ??
      "";
    const codigoBarras = longestDigitRun(idLine);

    const dataLine = body.match(/Data de pagamento:[^\n]*\n([^\n]+)/i)?.[1] ?? "";
    const paidAt = parseBrDate(lastOf(dataLine.match(BR_DATE_RE)));

    const cnpjCpf = digits(
      body.match(/Raz[aã]o Social:[^\n]*?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i)?.[1] ??
        null,
    );

    const autenticacao =
      body.match(/Autentica[çc][aã]o mec[aâ]nica[^\n]*\n\s*([A-F0-9]{20,})/i)?.[1] ??
      null;
    const ctrl = body.match(/CTRL\s+(\d+)/i)?.[1] ?? null;

    // Drop split fragments that carry neither a value nor a barcode (branch 2/3 parity).
    if (amount === null && codigoBarras === null) return;

    out.push({
      pageNumber,
      segmentIndex: segIndex,
      receiptType: RECEIPT_TYPE.boletoBarcode,
      amount,
      paidAt,
      chavePix: null,
      chavePixNormalized: null,
      cnpjCpf,
      banco: null,
      agencia: null,
      conta: null,
      identificacao: null,
      autenticacao,
      codigoBarras,
      ctrl,
      utility: null,
      rawText: body,
    });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Branch 5 — título payment ("Comprovante de Operação - Títulos Outros Bancos")
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses "Comprovante de Operação - Títulos Outros Bancos" pages (branch 5) —
 * the payer's proof of paying a título/boleto via Itaú Sispag. Modeled as a
 * `boleto_barcode` receipt with TWO keys so the ranked matcher can bind it:
 *   - codigoBarras → "Representação numérica do código de barras: <linha
 *     digitável>" (rank-1 key, vs `charges.linha_digitavel`).
 *   - cnpjCpf      → the FAVORECIDO's "CPF/CNPJ:" (the one that is NOT "do
 *     pagador"; rank-3 key, vs `charges.issuer_cnpj`).
 * amount → "Valor pago:"; paidAt → "Pagamento efetuado em"; `utility` null
 * (arbitrary beneficiary). Bodies split on the header, cut at "Cortar aqui".
 */
function parseTitulosPage(
  pageText: string,
  pageNumber: number,
): ParsedReceipt[] {
  const segments = pageText
    .split(TITULOS_PAYMENT_HEADER_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: ParsedReceipt[] = [];
  segments.forEach((segment, segIndex) => {
    const body = segment.split(CONCESSIONARIA_CUT_RE)[0].trim();
    if (!body) return;

    const amount = parseBrMoney(
      body.match(/Valor pago[:\s]*R\$\s*([\d.,]+)/i)?.[1] ?? null,
    );
    const codigoBarras = digits(
      body.match(/c[oó]digo de barras[:\s]*([\d\s]+)/i)?.[1] ?? null,
    );
    // Favorecido CNPJ — the "CPF/CNPJ:" that is NOT the pagador's.
    const cnpjCpf = digits(
      body.match(/CPF\s*\/?\s*CNPJ(?!\s*do\s*pagador)\s*:?\s*(\d[\d.\-/]*)/i)?.[1] ??
        null,
    );
    const dataRaw = body.match(/Pagamento efetuado em\s+([\d./]+)/i)?.[1] ?? null;
    const autenticacao =
      body.match(/Autentica[çc][aã]o[:\s]*\n?\s*([A-F0-9]{20,})/i)?.[1]?.trim() ??
      null;
    const ctrl = body.match(/CTRL\s+(\d+)/i)?.[1] ?? null;

    // Drop split fragments that carry neither a value nor a barcode (branch 2/3/4 parity).
    if (amount === null && codigoBarras === null) return;

    out.push({
      pageNumber,
      segmentIndex: segIndex,
      receiptType: RECEIPT_TYPE.boletoBarcode,
      amount,
      paidAt: parseBrDate(dataRaw),
      chavePix: null,
      chavePixNormalized: null,
      cnpjCpf,
      banco: null,
      agencia: null,
      conta: null,
      identificacao: null,
      autenticacao,
      codigoBarras,
      ctrl,
      utility: null,
      rawText: body,
    });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses per-page comprovante text into receipts. Débito-automático,
 * concessionária / ELETROPAULO, boleto-payment and título-payment pages yield
 * one receipt per segment; every other non-empty page yields exactly one
 * PIX/TED receipt. The boleto-payment and título headers are checked after
 * DA/concessionária so the shared "Comprovante de …" prefixes never mis-route.
 *
 * `startPage` (1-based) is the true document page of `pages[0]`. It MUST be
 * passed when `pages` is a chunk slice (chunked processing), or every receipt
 * would get the wrong `page_number` — corrupting the isolated-page storage path
 * and the page the hover/deep-dive opens. Defaults to 1 (whole-document call).
 */
export function parseComprovantePages(
  pages: string[],
  startPage = 1,
): ParsedReceipt[] {
  const receipts: ParsedReceipt[] = [];
  pages.forEach((raw, i) => {
    const pageNumber = startPage + i;
    const pageText = raw ?? "";
    if (DA_HEADER_RE.test(pageText)) {
      receipts.push(...parseDebitoAutomaticoPage(pageText, pageNumber));
    } else if (CONCESSIONARIA_HEADER_RE.test(pageText)) {
      receipts.push(...parseConcessionariaPage(pageText, pageNumber));
    } else if (BOLETO_PAYMENT_HEADER_RE.test(pageText)) {
      receipts.push(...parseBoletoPaymentPage(pageText, pageNumber));
    } else if (TITULOS_PAYMENT_HEADER_RE.test(pageText)) {
      receipts.push(...parseTitulosPage(pageText, pageNumber));
    } else if (pageText.trim().length > 0) {
      receipts.push(parsePixTedPage(pageText, pageNumber));
    }
  });
  return receipts;
}
