/**
 * Pure receipt-type → payment-method mapping. Kept in its own JSX-free module so
 * it can be imported by pure/unit-tested code (resolve-groups.ts) without
 * pulling in the client-only, JSX-containing write-helpers.
 */

import type { PaymentMethod, ReceiptType } from "@/lib/domain";

/** Receipt type → the payment method to record for a manual match. */
export function paymentMethodForReceipt(
  type: ReceiptType,
): PaymentMethod | null {
  switch (type) {
    case "pix":
      return "pix";
    case "ted":
      return "transferencia";
    case "debito_automatico":
      return "debito_automatico";
    default:
      return null;
  }
}
