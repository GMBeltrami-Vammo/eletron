/**
 * Comprovante-pipeline value types. Pure (no I/O, no `server-only`) so the
 * parser + matcher stay unit-testable.
 *
 * The parser (parse.ts) is a faithful port of the n8n `PDF_Comprovante_Processor`
 * workflow; the matcher (match.ts) is the NEW ranked design (review-resolutions
 * M12). Both feed the service-role pipeline (pipeline.ts).
 */

import type { ReceiptType } from "@/lib/domain";

/** Utility routed off a débito-automático receipt's `identificacao` label. */
export type ReceiptUtility = "enel" | "edp";

/**
 * One parsed receipt — a single PIX/TED page OR a single débito-automático
 * segment (D2: n8n's fractional `1.5` page → `(pageNumber 1, segmentIndex 1)`).
 * Maps 1:1 onto a `charging.receipts` row on `(document_id, page_number,
 * segment_index)`.
 */
export interface ParsedReceipt {
  /** 1-based physical PDF page. */
  pageNumber: number;
  /** 0 for single-receipt pages; 0..n for débito-automático segments on one page. */
  segmentIndex: number;
  receiptType: ReceiptType;
  /** Parsed amount (pt-BR money), null when unparseable. */
  amount: number | null;
  /** ISO `YYYY-MM-DD`, null when absent/unparseable. */
  paidAt: string | null;
  /** Raw PIX key as printed (email / phone / doc / uuid), null when absent. */
  chavePix: string | null;
  /** Comparison form of `chavePix` (normalizePixKey), null when absent. */
  chavePixNormalized: string | null;
  /** CNPJ/CPF, digits only, null when absent. */
  cnpjCpf: string | null;
  banco: string | null;
  /** Agência, digits only, null when absent. */
  agencia: string | null;
  /** Conta, digits only, null when absent. */
  conta: string | null;
  /** Débito-automático "Identificação no extrato" line. */
  identificacao: string | null;
  autenticacao: string | null;
  /** Trailing digits of `identificacao` (débito-automático installation code). */
  codigoBarras: string | null;
  /** CTRL field (some débito-automático layouts). */
  ctrl: string | null;
  /** enel/edp routed off `identificacao` ('DA ELETROPAULO' / 'DA EDP'). */
  utility: ReceiptUtility | null;
  /** The exact text the receipt was parsed from (stored for debugging). */
  rawText: string;
}

/**
 * An OPEN charge the matcher may bind a receipt to. Assembled by the pipeline
 * from `charges` + its billing account + counterparty (`value_tolerance`).
 * `chargeId` is the internal charging uuid.
 */
export interface OpenChargeCandidate {
  chargeId: string;
  amount: number | null;
  /** First-of-month `YYYY-MM-01`, null when unknown. */
  competencia: string | null;
  dueDate: string | null;
  chavePix: string | null;
  /** Issuer CNPJ/CPF (charge or counterparty); compared digits-only. */
  issuerCnpj: string | null;
  agencia: string | null;
  conta: string | null;
  linhaDigitavel: string | null;
  autoDebitRegistration: string | null;
  /** Per-counterparty amount tolerance (default 0.01; Kitchen Central 1.00). */
  valueTolerance: number;
  /** true = an OPEN charge; false = a `pago`-without-comprovante charge (energy
   * only). Used to prefer the open survivor when the key/amount is ambiguous. */
  isOpen: boolean;
}

/**
 * `discard` = the receipt's amount matches NO charge in the whole pool — it is
 * not one of ours (Gabriel's rule 1: "se o valor não bate com nenhum valor da
 * planilha, automaticamente descartado"). The pipeline persists it as
 * `rejected` so it never reaches the review queue.
 */
export type MatchOutcome = "auto" | "ambiguous" | "none" | "discard";

/** Which ranked key the matcher decided on. */
export type MatchRule =
  | "linha_digitavel"
  | "codigo_barras"
  | "chave_pix"
  | "cnpj_cpf"
  | "agencia_conta";

export interface MatchResult {
  outcome: MatchOutcome;
  /** Set only when `outcome === 'auto'`. */
  chargeId?: string;
  /** The rank that decided (winning key). */
  rule?: MatchRule;
  /** All candidates that survived (≥2 ⇒ ambiguous). */
  candidateIds?: string[];
  /** pt-BR explanation lines (stored in `receipts.match_notes`). */
  reasons: string[];
}
