/**
 * Shared value types for the comprovantes UX (inbox, deep-dive, review queue).
 *
 * No runtime directive: this module is imported by BOTH the server read layer
 * (`queries.ts`, `server-only`) and the client components, so it must stay
 * free of `server-only`/`"use server"`. All shapes are serializable — they
 * cross the server→client boundary as TanStack Query data.
 */

import type {
  ChargeKind,
  ChargeStatus,
  DocProcessingStatus,
  IngestSource,
  MatchStatus,
  PaymentMethod,
  ReceiptType,
} from "@/lib/domain";

/** Viewer identity + write role, resolved server-side (RLS is the real gate). */
export interface ViewerContext {
  email: string | null;
  role: "admin" | "operator" | null;
  isOperator: boolean;
  isAdmin: boolean;
}

// ── Inbox ───────────────────────────────────────────────────────────────────

export interface InboxKpis {
  /** Comprovante documents uploaded in the current month. */
  enviadosMes: number;
  /** Receipts extracted across all comprovante documents. */
  recibosExtraidos: number;
  /** Receipts whose charge is confirmed paid (human `pago`). */
  conciliadosConfirmados: number;
  /** Receipts still unmatched / needs-review (links to the review queue). */
  aguardandoRevisao: number;
}

export interface InboxDocRow {
  id: string;
  filename: string | null;
  uploadedByEmail: string | null;
  createdAt: string | null;
  pageCount: number | null;
  receiptCount: number;
  /** Conciliation breakdown (per `receipts.match_status`). */
  conciliados: number;
  ambiguos: number;
  semCorresp: number;
  processingStatus: DocProcessingStatus;
  processingError: string | null;
  source: IngestSource;
}

export interface InboxData {
  /** false when Supabase env is absent or the session is missing (degrade to empty). */
  available: boolean;
  rows: InboxDocRow[];
  kpis: InboxKpis;
}

// ── Deep-dive ─────────────────────────────────────────────────────────────

/** Which match badge a receipt card shows (see decision #24 confirm gate). */
export type ReceiptBadgeKind =
  | "conciliado" // has payment(s), all confirmed (charge pago)
  | "awaiting" // auto-matched, awaiting human confirm
  | "ambiguous" // needs_review
  | "unmatched"; // no correspondence

export interface PaymentView {
  id: string;
  amount: number | null;
  paidAt: string | null;
  method: PaymentMethod | null;
  source: IngestSource;
  createdByEmail: string | null;
  createdAt: string | null;
  receiptId: string | null;
  chargeId: string;
  chargeKind: ChargeKind;
  chargeCompetencia: string | null;
  chargeAmount: number | null;
  chargeStatus: ChargeStatus;
  chargeDueDate: string | null;
  stationId: number | null;
  stationName: string | null;
  /** Locador/fornecedor razão social + CNPJ (via billing_account → counterparty). */
  counterpartyName: string | null;
  counterpartyCnpj: string | null;
  /** charge.status === 'pago' — a named human confirmed it. */
  confirmed: boolean;
}

export interface ReceiptView {
  id: string;
  pageNumber: number;
  segmentIndex: number;
  receiptType: ReceiptType;
  amount: number | null;
  paidAt: string | null;
  chavePix: string | null;
  cnpjCpf: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  identificacao: string | null;
  autenticacao: string | null;
  codigoBarras: string | null;
  ctrl: string | null;
  matchStatus: MatchStatus;
  matchedByEmail: string | null;
  matchedAt: string | null;
  matchNotes: string | null;
  rawText: string | null;
  /** amount minus the sum of this receipt's payments (null when amount unknown). */
  remaining: number | null;
  payments: PaymentView[];
  badge: ReceiptBadgeKind;
  /** charge to `confirm_charge` when badge === 'awaiting'. */
  awaitingChargeId: string | null;
}

export interface DocumentHeader {
  id: string;
  filename: string | null;
  contentHash: string;
  uploadedByEmail: string | null;
  createdAt: string | null;
  processedAt: string | null;
  processingStatus: DocProcessingStatus;
  processingError: string | null;
  pageCount: number | null;
  webViewLink: string | null;
  source: IngestSource;
}

export interface DeepDiveData {
  available: boolean;
  found: boolean;
  document: DocumentHeader | null;
  receipts: ReceiptView[];
  /** All payments of the document, flattened for the Vínculos table. */
  payments: PaymentView[];
  /** Distinct stations of the bound charges. */
  stations: { id: number; name: string | null }[];
  totals: {
    receiptsSum: number | null;
    allocatedSum: number;
    remaining: number | null;
  };
}

// ── Charge picker ─────────────────────────────────────────────────────────

export interface OpenChargeOption {
  id: string;
  kind: ChargeKind;
  competencia: string | null;
  amount: number | null;
  /** amount minus already-allocated payments (default value source). */
  openAmount: number | null;
  dueDate: string | null;
  status: ChargeStatus;
  stationId: number | null;
  stationName: string | null;
  dedupeKey: string;
}

// ── Review queue ────────────────────────────────────────────────────────────

export interface ReviewCandidate {
  id: string;
  kind: ChargeKind;
  competencia: string | null;
  amount: number | null;
  stationId: number | null;
  stationName: string | null;
  /** Enriched fields so a human can confirm a match without leaving the queue. */
  dueDate: string | null;
  status: ChargeStatus;
  dedupeKey: string;
  /** Counterparty razão social (landlord/supplier) — the strongest yes/no signal. */
  counterpartyName: string | null;
  chavePix: string | null;
  issuerCnpj: string | null;
  agencia: string | null;
  conta: string | null;
}

export interface ReviewReceiptRow {
  id: string;
  documentId: string;
  filename: string | null;
  createdAt: string | null;
  uploadedByEmail: string | null;
  pageNumber: number;
  segmentIndex: number;
  receiptType: ReceiptType;
  amount: number | null;
  paidAt: string | null;
  chavePix: string | null;
  cnpjCpf: string | null;
  agencia: string | null;
  conta: string | null;
  banco: string | null;
  identificacao: string | null;
  codigoBarras: string | null;
  matchStatus: MatchStatus;
  matchNotes: string | null;
  rawText: string | null;
  candidateIds: string[];
  candidates: ReviewCandidate[];
}

export interface ReviewData {
  available: boolean;
  rows: ReviewReceiptRow[];
}
