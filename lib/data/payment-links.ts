import "server-only";

/**
 * Payment linkage (Phase 2.5 R1) — joins `charging.payments` → `receipts` →
 * `documents` so ledger screens (/energia faturas, /pagamentos, station 360,
 * /alugueis) can render "paid via comprovante" chips that deep-link to
 * `/comprovantes/{documentId}?page=N`.
 *
 * The DomainSnapshot deliberately does NOT carry payments (they only exist on
 * the Supabase backend), so this is a separate direct read in the same style
 * as charge-refs.ts: keyed BOTH by charge uuid and by `dedupe_key` (the
 * backend-agnostic domain id), degrading to empty maps when Supabase env is
 * absent — screens then simply render no chips (sheets/dev mode).
 *
 * The pure join + summary helpers live in payment-links.shared.ts (client-safe,
 * unit-tested); this module only adds the paginated DB reads.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  indexPaymentLinks,
  type ChargeKeyRow,
  type PaymentJoinRow,
  type PaymentLinkIndex,
  type PaymentLinkSummary,
  type ReceiptJoinRow,
} from "./payment-links.shared";

export { summarizeLinks } from "./payment-links.shared";
export type { PaymentLinkIndex, PaymentLinkSummary };

const EMPTY: PaymentLinkIndex = { byChargeUuid: new Map(), byDedupeKey: new Map() };
const PAGE = 1000;

interface Pageable {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

async function readAll<T>(build: () => unknown): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (build() as Pageable).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Reads the full payments→receipts join. Never throws (empty on failure). */
export async function readPaymentLinks(): Promise<PaymentLinkIndex> {
  try {
    const admin = supabaseAdmin();
    const payments = await readAll<PaymentJoinRow>(() =>
      admin
        .from("payments")
        .select("id, charge_id, amount, paid_at, receipt_id")
        .order("id", { ascending: true }),
    );
    if (payments.length === 0) return EMPTY;

    const receiptIds = [
      ...new Set(payments.map((p) => p.receipt_id).filter((x): x is string => x !== null)),
    ];
    const receipts: ReceiptJoinRow[] = [];
    for (let i = 0; i < receiptIds.length; i += 200) {
      const { data, error } = await admin
        .from("receipts")
        .select("id, document_id, page_number")
        .in("id", receiptIds.slice(i, i + 200));
      if (error) throw new Error(error.message);
      receipts.push(...((data ?? []) as ReceiptJoinRow[]));
    }

    const chargeUuids = [...new Set(payments.map((p) => p.charge_id))];
    const chargeKeys: ChargeKeyRow[] = [];
    for (let i = 0; i < chargeUuids.length; i += 200) {
      const { data, error } = await admin
        .from("charges")
        .select("id, dedupe_key")
        .in("id", chargeUuids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      chargeKeys.push(...((data ?? []) as ChargeKeyRow[]));
    }

    return indexPaymentLinks(payments, receipts, chargeKeys);
  } catch {
    return EMPTY;
  }
}
