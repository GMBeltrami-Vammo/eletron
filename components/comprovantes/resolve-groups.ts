/**
 * Pure grouping logic for the review-queue "resolver grupo" (N↔N) control.
 * Kept out of the client component so it is unit-testable (no React, no
 * server-only imports — the `ResolveGroupPair` import is type-only/erased).
 */

import type { ResolveGroupPair } from "@/app/actions/charges";
import { paymentMethodForReceipt } from "./payment-method";
import type { ReviewCandidate, ReviewReceiptRow } from "./types";

/**
 * A symmetric ambiguous group: N receipts that all match the SAME set of N open
 * charges (same landlord/key + same value), so any receipt↔charge bijection is
 * equivalent and the whole group can be settled 1:1 in one confirmed click.
 */
export interface ResolvableGroup {
  key: string;
  receipts: ReviewReceiptRow[];
  candidates: ReviewCandidate[];
  pairs: ResolveGroupPair[];
}

/**
 * Buckets the ambiguous receipts by their (sorted) candidate-id set and keeps
 * only the SYMMETRIC ones — exactly N receipts for N candidate charges, every
 * receipt with a parsed amount. Those are safe to auto-pair 1:1 on confirm
 * (interchangeable); asymmetric buckets (e.g. 1 receipt ↔ 3 charges, or 3 ↔ 2)
 * stay in the per-row manual flow. The receipt↔charge zip is deterministic
 * (both sorted by id) but the assignment is arbitrary by design.
 */
export function buildResolvableGroups(
  rows: ReviewReceiptRow[],
): ResolvableGroup[] {
  const byKey = new Map<string, ReviewReceiptRow[]>();
  for (const r of rows) {
    if (r.candidateIds.length < 2 || r.amount === null) continue;
    const key = [...r.candidateIds].sort().join("|");
    const bucket = byKey.get(key);
    if (bucket) bucket.push(r);
    else byKey.set(key, [r]);
  }

  const groups: ResolvableGroup[] = [];
  for (const [key, receipts] of byKey) {
    const candIds = key.split("|");
    if (receipts.length !== candIds.length) continue; // must be exactly N ↔ N
    // All receipts must share the SAME amount so any bijection binds an exact
    // payment to its charge (the equal-rent case). Mixed amounts → stay manual.
    const amt = receipts[0].amount;
    if (!receipts.every((r) => r.amount === amt)) continue;
    const rs = [...receipts].sort((a, b) => (a.id < b.id ? -1 : 1));
    const cs = [...candIds].sort();
    const pairs: ResolveGroupPair[] = rs.map((r, i) => ({
      chargeId: cs[i],
      receiptId: r.id,
      amount: r.amount as number,
      paidAt: r.paidAt,
      method: paymentMethodForReceipt(r.receiptType),
    }));
    groups.push({ key, receipts: rs, candidates: receipts[0].candidates, pairs });
  }
  return groups;
}
