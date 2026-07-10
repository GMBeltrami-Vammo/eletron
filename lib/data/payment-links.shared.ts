/**
 * Environment-neutral half of payment-links: the plain-JSON summary shape
 * embedded in table rows, the pure payments→receipts join, and the deep-link
 * builder. NO `server-only` and no Supabase import here — client table cells
 * and unit tests import this; the DB reads live in payment-links.ts.
 */

export interface PaymentLink {
  paymentId: string;
  amount: number | null;
  paidAt: string | null;
  receiptId: string | null;
  /** charging.documents.id — the /comprovantes/[id] route param. */
  documentId: string | null;
  /** 1-based PDF page of the receipt inside its document. */
  page: number | null;
}

export interface PaymentLinkSummary {
  count: number;
  /** Sum of payment amounts (null when none carry an amount). */
  paidAmount: number | null;
  /** First linked comprovante: the /comprovantes/[id] route param. */
  documentId: string | null;
  page: number | null;
}

export interface PaymentLinkIndex {
  byChargeUuid: Map<string, PaymentLink[]>;
  byDedupeKey: Map<string, PaymentLink[]>;
}

export interface PaymentJoinRow {
  id: string;
  charge_id: string;
  amount: number | null;
  paid_at: string | null;
  receipt_id: string | null;
}
export interface ReceiptJoinRow {
  id: string;
  document_id: string | null;
  page_number: number | null;
}
export interface ChargeKeyRow {
  id: string;
  dedupe_key: string;
}

/** Pure join — unit-tested; readPaymentLinks feeds it the DB rows. */
export function indexPaymentLinks(
  payments: PaymentJoinRow[],
  receipts: ReceiptJoinRow[],
  chargeKeys: ChargeKeyRow[],
): PaymentLinkIndex {
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const byChargeUuid = new Map<string, PaymentLink[]>();
  for (const p of payments) {
    const receipt = p.receipt_id ? (receiptById.get(p.receipt_id) ?? null) : null;
    const link: PaymentLink = {
      paymentId: p.id,
      amount: p.amount,
      paidAt: p.paid_at,
      receiptId: p.receipt_id,
      documentId: receipt?.document_id ?? null,
      page: receipt?.page_number ?? null,
    };
    const list = byChargeUuid.get(p.charge_id);
    if (list) list.push(link);
    else byChargeUuid.set(p.charge_id, [link]);
  }
  const byDedupeKey = new Map<string, PaymentLink[]>();
  for (const c of chargeKeys) {
    const links = byChargeUuid.get(c.id);
    if (links) byDedupeKey.set(c.dedupe_key, links);
  }
  return { byChargeUuid, byDedupeKey };
}

/** One PaymentLink[] → the plain-JSON summary rows embed. */
export function summarizeLinks(
  links: PaymentLink[] | undefined,
): PaymentLinkSummary | null {
  if (!links || links.length === 0) return null;
  const amounts = links.map((l) => l.amount).filter((a): a is number => a !== null);
  const withDoc = links.find((l) => l.documentId !== null);
  return {
    count: links.length,
    paidAmount: amounts.length > 0 ? amounts.reduce((s, a) => s + a, 0) : null,
    documentId: withDoc?.documentId ?? null,
    page: withDoc?.page ?? null,
  };
}

/** The chip's href for a summary (null when no linked document). */
export function comprovanteHref(s: PaymentLinkSummary | null): string | null {
  if (!s || !s.documentId) return null;
  return s.page !== null && s.page > 1
    ? `/comprovantes/${s.documentId}?page=${s.page}`
    : `/comprovantes/${s.documentId}`;
}

/**
 * Source of the isolated matched-page PDF for the chip's hover preview
 * (`/api/files/[documentId]/page/[page]`) — the per-page Supabase artifact the
 * pipeline eagerly materializes at match time (falls back to page 1). Null when
 * no linked document.
 */
export function comprovantePageSrc(s: PaymentLinkSummary | null): string | null {
  if (!s || !s.documentId) return null;
  const page = s.page && s.page > 0 ? s.page : 1;
  return `/api/files/${s.documentId}/page/${page}`;
}
