/**
 * Plain JSON-serializable row shape for /pagamentos (the 2_Pagamentos
 * successor). Built server-side in app/(app)/pagamentos/page.tsx; the client
 * view never touches raw sheet strings.
 */

import type {
  AccountType,
  AutoDebitStatus,
  ChargeKind,
  ChargeStatus,
  IngestSource,
  MatchStatus,
  PaymentMethod,
} from "@/lib/domain";
import type { PaymentLinkSummary } from "@/lib/data/payment-links.shared";

export interface PagamentoRow {
  chargeId: string;
  stationId: number | null;
  stationName: string | null;
  matchStatus: MatchStatus;
  /** 'YYYY-MM-01' or null. */
  competencia: string | null;
  /** Vencimento (charges.due_date, 'YYYY-MM-DD') — the faturas-sheet due_date. */
  dueDate: string | null;
  /** Débito automático of the energy account (null for rent/third-party). */
  autoDebit: AutoDebitStatus | null;
  kind: ChargeKind;
  /** Counterparty resolved via billing account → contract/counterparty. */
  parceiro: string | null;
  /**
   * Billing-account type (energy_enel/energy_edp/rent/third_party) — drives the
   * Enel/EDP vs "Aluguel e outros" tab split and the provider-label fallback
   * when `parceiro` is null. Null when the charge has no billing account.
   */
  accountType: AccountType | null;
  /** Enel id / EDP UC of the billing account (energy rows); null otherwise. */
  installationKey: string | null;
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
  /** Postgres uuid (resolved from dedupe_key via charge-refs); null in sheets/dev. */
  chargeUuid: string | null;
  /** gerar_mes / pipeline flags (empty on sheet-backfill rows). */
  flags: string[];
  /** "Enviado ao fiscal" (2_Pagamentos "No Fiscal" col) — exported, NOT paid. */
  fiscalExported: boolean;
  /** 'rpc' = human-set (sticky); 'sync' = pipeline; null when unknown. */
  statusSource: "sync" | "rpc" | null;
  /** Last write actor + timestamp for the AuditByline (rpc-touched rows only). */
  lastActorEmail: string | null;
  lastActorAt: string | null;
  /** Linked charging.payments coverage (R1) — null when none / sheets mode. */
  payment: PaymentLinkSummary | null;
  /**
   * Source bill (boleto/fatura/nota) href for the "Documento de origem" column:
   * energy → the Drive fatura link; rent/manual → the /api/files proxy; null
   * when nothing is bound. Distinct from `payment` (the payment-proof
   * comprovante). Resolved by resolveDocumentHref() in buildRows.
   */
  documentHref: string | null;
  /**
   * The bound source-bill document id (charges.source_document_id), or null.
   * Drives the "Desvincular documento" row action; distinct from documentHref
   * (which also covers the energy Drive-fatura fallback that has no doc row).
   */
  sourceDocumentId: string | null;
}

/** Lightweight station option for the "Nova cobrança manual" station picker. */
export interface StationOption {
  id: number;
  name: string | null;
}
