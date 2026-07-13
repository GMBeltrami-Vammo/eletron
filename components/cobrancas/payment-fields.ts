/**
 * Which payment-instrument field groups the chosen forma de pagamento needs
 * (decisão #47): transferência é executada com banco/agência/conta; pix com a
 * chave; boleto com a linha digitável. JSX-free so it stays unit-testable
 * (same pattern as comprovantes/payment-method.ts, #43).
 */

import type { PaymentMethod } from "@/lib/domain";

export type PaymentFieldGroup = "banco_agencia_conta" | "chave_pix" | "codigo_boleto";

export function visiblePaymentFields(method: PaymentMethod | ""): PaymentFieldGroup[] {
  switch (method) {
    case "transferencia":
      return ["banco_agencia_conta"];
    case "pix":
      return ["chave_pix"];
    case "boleto_email":
    case "boleto_celular":
      return ["codigo_boleto"];
    default:
      // débito automático / outro / não informado — no manual instrument
      return [];
  }
}
