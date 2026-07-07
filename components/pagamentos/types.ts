/**
 * Plain JSON-serializable row shape for /pagamentos (the 2_Pagamentos
 * successor). Built server-side in app/(app)/pagamentos/page.tsx; the client
 * view never touches raw sheet strings.
 */

import type {
  ChargeKind,
  ChargeStatus,
  IngestSource,
  MatchStatus,
  PaymentMethod,
} from "@/lib/domain";

export interface PagamentoRow {
  chargeId: string;
  stationId: number | null;
  stationName: string | null;
  matchStatus: MatchStatus;
  /** 'YYYY-MM-01' or null. */
  competencia: string | null;
  kind: ChargeKind;
  /** Counterparty resolved via billing account → contract/counterparty. */
  parceiro: string | null;
  /** Documento/Boleto value. */
  amount: number | null;
  /** Planilha/contract expectation (mismatch highlight when they differ). */
  expectedAmount: number | null;
  status: ChargeStatus;
  paymentMethod: PaymentMethod | null;
  notaFiscal: string | null;
  source: IngestSource;
  dedupeKey: string;
  notes: string | null;
}
