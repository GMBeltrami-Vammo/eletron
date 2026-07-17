/**
 * Pure predicates + group builder for the /pagamentos "Documentos de e-mail"
 * staging tab (decisão #47). TWO predicates, single source of truth:
 *
 *   - isStagedEmailCharge — HIDDEN from the ledger tabs (Enel/EDP, Locação,
 *     A pagar) until a human approves. Only webhook-CREATED rows are staged:
 *     `source='email_ai'` is the reliable discriminator because the ingest
 *     convergence patch never touches `source` (lib/ingest/cobrancas.ts) — a
 *     converged gerar_mes rent row keeps source='gerar_mes' and stays visible.
 *
 *   - isEmailDocRow — appears IN the tab: every needs_review charge tied to an
 *     email-intake document, i.e. webhook-created rows PLUS converged rows
 *     whose attached document came from the email pipeline. The sidebar badge
 *     (countEmailDocPending) applies this same predicate — tab count and badge
 *     can never drift.
 *
 * No React/server imports — unit-testable (same pattern as
 * components/revisao/unify-proposals.ts).
 */

import type { ReviewChargeRow } from "@/app/(app)/revisao/cobrancas/queries";

/**
 * Settled/terminal statuses exit staging even while match_status is still
 * needs_review: the comprovante matcher can flip a staged charge to `pago`
 * WITHOUT touching match_status — that paid money must re-enter the ledger
 * tabs/KPIs immediately, and the tab must not hold a row whose Enviar and
 * Descartar would both dead-end (reclassify refuses paid; discard skips it).
 */
const UNSTAGED_STATUSES: ReadonlySet<string> = new Set([
  "pago",
  "antecipado",
  "conciliado",
  "cancelada",
  "nao_aplicavel",
]);

/** Hidden from the ledger tabs until approved (webhook-created only). */
export function isStagedEmailCharge(r: {
  source: string;
  matchStatus: string;
  status: string;
}): boolean {
  return (
    r.source === "email_ai" &&
    r.matchStatus === "needs_review" &&
    !UNSTAGED_STATUSES.has(r.status)
  );
}

/** Appears in the Documentos de e-mail tab (badge uses the same predicate). */
export function isEmailDocRow(r: {
  matchStatus: string;
  source: string;
  status: string;
  documentId: string | null;
  documentSource: string | null;
}): boolean {
  if (r.matchStatus !== "needs_review") return false;
  if (UNSTAGED_STATUSES.has(r.status)) return false;
  if (r.source === "email_ai") return true;
  // converged row: pre-existing charge (gerar_mes etc.) that received an
  // email-intake document — reviewable in the tab, but never staged out.
  return r.documentId !== null && r.documentSource === "email_ai";
}

/**
 * A pag:-keyed email charge IS the cadastro's rent charge for the month
 * (email-first convergence, #20/#27): discarding it would cancel the month's
 * rent and gerar_mes would silently skip it (ON CONFLICT DO NOTHING). The
 * discard RPC refuses these; the UI offers Desvincular/Reclassificar instead.
 */
export function isDiscardableEmailCharge(r: {
  source: string;
  dedupeKey: string;
}): boolean {
  return r.source === "email_ai" && !/^pag:\d+:/.test(r.dedupeKey);
}

export interface EmailDocGroup {
  /** null = defensive "Sem documento" bucket (shouldn't occur in practice). */
  documentId: string | null;
  filename: string | null;
  /** Normalized external sender of the first charge carrying one (#38). */
  remetente: string | null;
  /** All e-mail addresses the document arrived through (#47 traceability). */
  addresses: string[];
  /** documents.created_at — when the document entered the system. */
  receivedAt: string | null;
  /** dueDate asc, nulls last (operational urgency order). */
  charges: ReviewChargeRow[];
}

function dueDateAscNullsLast(a: ReviewChargeRow, b: ReviewChargeRow): number {
  if (a.dueDate === null && b.dueDate === null) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

/** Groups tab rows by source document; groups newest-received first. */
export function buildEmailDocGroups(rows: ReviewChargeRow[]): EmailDocGroup[] {
  const byDoc = new Map<string, EmailDocGroup>();
  const NO_DOC = "__sem_documento__";

  for (const r of rows) {
    const key = r.documentId ?? NO_DOC;
    let group = byDoc.get(key);
    if (!group) {
      group = {
        documentId: r.documentId,
        filename: r.documentFilename,
        remetente: r.emailSender,
        addresses: [...r.documentAddresses],
        receivedAt: r.documentCreatedAt,
        charges: [],
      };
      byDoc.set(key, group);
    }
    // first non-null sender wins (charges of one doc share the sender anyway)
    if (group.remetente === null && r.emailSender !== null) {
      group.remetente = r.emailSender;
    }
    // union addresses across the doc's charges (they share a document, so this
    // is defensive — but keeps the header complete if rows ever disagree)
    for (const a of r.documentAddresses) {
      if (!group.addresses.includes(a)) group.addresses.push(a);
    }
    group.charges.push(r);
  }

  const groups = [...byDoc.values()];
  for (const g of groups) g.charges.sort(dueDateAscNullsLast);
  groups.sort((a, b) => {
    // newest received first; the no-doc bucket (null receivedAt) sinks last
    if (a.receivedAt === null && b.receivedAt === null) return 0;
    if (a.receivedAt === null) return 1;
    if (b.receivedAt === null) return -1;
    return a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0;
  });
  return groups;
}

/** Advisory completeness gaps — chips only, approval is never blocked. */
export type ReadinessGap = "valor" | "estacao" | "vencimento" | "metodo";

export const READINESS_GAP_LABEL: Record<ReadinessGap, string> = {
  valor: "sem valor",
  estacao: "sem estação",
  vencimento: "sem vencimento",
  metodo: "sem método",
};

export function chargeReadiness(r: {
  amount: number | null;
  stationId: number | null;
  dueDate: string | null;
  paymentMethod: string | null;
}): ReadinessGap[] {
  const gaps: ReadinessGap[] = [];
  if (r.amount === null || r.amount <= 0) gaps.push("valor");
  if (r.stationId === null) gaps.push("estacao");
  if (r.dueDate === null) gaps.push("vencimento");
  if (r.paymentMethod === null) gaps.push("metodo");
  return gaps;
}

/**
 * Ready for the bulk "Enviar todas" (Gabriel 2026-07-14): a boleto — or an
 * unclassified charge, since boleto is the default — needs a nota fiscal to be
 * approved; pix/transferência don't. Charges that aren't ready must be
 * classified one-by-one via the per-charge "Enviar para Pagamentos" dialog.
 */
export function isReadyToSendToPagamentos(r: {
  paymentMethod: string | null;
  notaFiscal: string | null;
}): boolean {
  if (r.paymentMethod === "pix" || r.paymentMethod === "transferencia") return true;
  return (r.notaFiscal ?? "").trim() !== "";
}
