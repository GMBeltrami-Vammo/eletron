/**
 * Domain entity types mirroring the future Supabase `eletron` schema
 * (docs/superpowers/specs/appendix/data-model.md §2).
 *
 * Conventions (Phase 1, in-memory snapshot):
 * - Names are camelCase in TS; the Postgres column is documented in JSDoc when
 *   the mapping is non-obvious.
 * - Dates are ISO strings: `YYYY-MM-DD` for dates, `YYYY-MM-DDTHH:mm:ss` for
 *   timestamps (BRT wall-clock as written by the scraper — Phase 2 converts to
 *   timestamptz).
 * - Money and kWh are already-parsed `number`s (Postgres numeric).
 * - Entity ids are deterministic strings derived from natural keys
 *   (`enel:{enel_id}`, `edp:{uc}`, `rent:{cadastro_id}`, ...) so the snapshot
 *   is stable between loads; Phase 2 swaps them for uuids.
 * - Fields the sheets sometimes leave blank are `| null` even where the
 *   Postgres column is NOT NULL — Phase 1 surfaces the gap as a
 *   NormalizationIssue instead of inventing a value.
 */

import type {
  AccountType,
  AdjustmentIndex,
  AdjustmentStatus,
  AlertSeverity,
  AlertStatus,
  AlertType,
  AutoDebitStatus,
  ChargeKind,
  ChargeLineKind,
  ChargeStatus,
  CompetenciaSource,
  ContractType,
  CounterpartyKind,
  DocProcessingStatus,
  DocumentKind,
  DriveFolderKind,
  IngestSource,
  MatchStatus,
  PaymentMethod,
  ReceiptType,
  StationStatus,
  UtilityBillStatus,
} from "./enums";

/** eletron.stations — natural PK = swap_station_id. Source: Vammo_data tab. */
export interface Station {
  /** swap_station_id (integer PK). */
  id: number;
  /** swap_station_name. */
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** NOT NULL in Postgres; null here when the sheet cell is blank (issue logged). */
  status: StationStatus | null;
  /** source_created_at — created_at from backoffice, full ISO with offset. */
  sourceCreatedAt: string | null;
  /**
   * Installed boxes per Metabase card 28556 (R1 — metabase-sync). Optional:
   * only the Supabase backend carries it; sheets/fixtures leave it undefined.
   */
  activeBoxes?: number | null;
  /** When active_boxes was last refreshed from Metabase. */
  boxesSyncedAt?: string | null;
  /** Raw source row, header-name keyed (excess-of-info principle). */
  raw: Record<string, string>;
}

/** eletron.counterparties — landlords, condos, intermediaries, SPEs, utilities. */
export interface Counterparty {
  /** Deterministic: `cp:{cnpj_digits}` or `cp:name:{slug}` when no CNPJ. */
  id: string;
  name: string;
  /** cnpj_cpf — digits only (11 or 14), normalized. */
  cnpjCpf: string | null;
  kind: CounterpartyKind;
  notes: string | null;
}

/** eletron.contracts — the ~25-field 1_Cadastro model. */
export interface Contract {
  /** Deterministic: `contract:{cadastro_id}`. */
  id: string;
  /** cadastro_id — legacy 1_Cadastro PK. */
  cadastroId: number | null;
  /** station_id — nullable: contract may precede station match. */
  stationId: number | null;
  counterpartyId: string | null;
  /** Status_Locacao; null when the sheet cell is blank/unknown (issue logged). */
  status: StationStatus | null;
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** enel_connection_number — 'Número da Conexão' (text: zero-padded values exist). */
  enelConnectionNumber: string | null;
  contractType: ContractType | null;
  boxCount: number | null;
  minBox: number | null;
  /** valor_por_box (numeric 12,2). */
  valorPorBox: number | null;
  valorMensal: number | null;
  /** due_day — 'Vencimento (dia)', 1..31. */
  dueDay: number | null;
  paymentMethod: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  startsOn: string | null;
  endsOn: string | null;
  observations: string | null;
  raw: Record<string, string>;
}

/** eletron.billing_accounts — the hub: station 1—N accounts. */
export interface BillingAccount {
  /**
   * Deterministic: `enel:{enel_id}` | `edp:{uc}` | `rent:{cadastro_id}` |
   * `3p:{cnpj_digits|name-slug}:{station_id|'unmatched'}`.
   */
  id: string;
  /** station_id — NULLABLE: 'Unidentified' scraper rows live here unmatched. */
  stationId: number | null;
  accountType: AccountType;
  /** enel_id — ENEL installation number, text (zero-padded values exist). */
  enelId: string | null;
  /** edp_uc — EDP unidade consumidora (dedupe/matching key). */
  edpUc: string | null;
  /** edp_contract_id — edp_id (12-digit portal contract). */
  edpContractId: string | null;
  /** contract_id — for accountType='rent'. */
  contractId: string | null;
  /** counterparty_id — for accountType='third_party'. */
  counterpartyId: string | null;
  externalRef: string | null;
  autoDebitRegistration: string | null;
  matchStatus: MatchStatus;
  isActive: boolean;
  notes: string | null;
}

/** eletron.utility_account_state — current per-installation scraper state. */
export interface UtilityAccountState {
  /** billing_account_id (PK). */
  billingAccountId: string;
  /** provider_station_status — portal contract status ('CONTRATO ATIVO', ...). */
  providerStationStatus: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  billStatus: UtilityBillStatus | null;
  /** bill_status_raw — portal literal preserved. */
  billStatusRaw: string | null;
  /** last_billing (numeric 12,2). */
  lastBilling: number | null;
  dueDate: string | null;
  autoDebit: AutoDebitStatus;
  autoDebitRegistration: string | null;
  accountEmail: string | null;
  /** negotiated_invoices — raw 'mês/yy' literals preserved. */
  negotiatedInvoices: string[];
  /**
   * Parsed companion to negotiatedInvoices: 'YYYY-MM' entries (unparseable
   * literals are dropped here and logged as issues). Not a Postgres column —
   * exists so derive.ts never touches raw sheet strings.
   */
  negotiatedCompetencias: string[];
  /** invoice_history — raw literals preserved ('Pendente', 'Paga', ...). */
  invoiceHistory: string[];
  /**
   * Parsed companion to invoiceHistory (unknown literals → null kept
   * positionally). Not a Postgres column — see negotiatedCompetencias.
   */
  invoiceHistoryStatuses: (UtilityBillStatus | null)[];
  /** shutdown_date / shutdown_start / shutdown_end — ENEL scheduled outage. */
  shutdownDate: string | null;
  shutdownStart: string | null;
  shutdownEnd: string | null;
  /** first_seen_at — write-once first_seen_time. */
  firstSeenAt: string | null;
  /** scraped_at — freshness signal (scraping_time). */
  scrapedAt: string | null;
  lat: number | null;
  lon: number | null;
  /** ultima_fatura_flag — n8n-maintained 'Ultima Fatura' cell, carried for parity. */
  ultimaFaturaFlag: string | null;
  /** ultimo_comprovante — n8n-maintained cell, carried for parity. */
  ultimoComprovante: string | null;
  /**
   * Leading ISO date extracted from ultimoComprovante (receipt registration
   * date). Not a Postgres column — used by the overdue-minus-receipted rule.
   */
  ultimoComprovanteDate: string | null;
  /** is_status_carried_forward — 'Sem contas' carries stale status forward. */
  isStatusCarriedForward: boolean;
  raw: Record<string, string>;
}

/** eletron.monthly_consumption — F_/R_ matrix + EDP kWh columns, unpivoted. */
export interface MonthlyConsumption {
  billingAccountId: string;
  /** competencia — first of month, 'YYYY-MM-01'. */
  competencia: string;
  /** kwh_billed — F_MMMAA (EDP: the single consumo column). */
  kwhBilled: number | null;
  /** kwh_recorded — R_MMMAA (ENEL only). */
  kwhRecorded: number | null;
  source: IngestSource;
}

/** eletron.charges — the unified payables ledger. One row = one thing to pay. */
export interface Charge {
  /** Deterministic: equals dedupeKey in Phase 1. */
  id: string;
  /** billing_account_id — NULLABLE = UNIDENTIFIED. */
  billingAccountId: string | null;
  /** station_id — denormalized from account; NULL when unmatched. */
  stationId: number | null;
  kind: ChargeKind;
  /** competencia — 'YYYY-MM-01'; NULLABLE (often absent on raw boletos). */
  competencia: string | null;
  competenciaSource: CompetenciaSource;
  /**
   * amount — NOT NULL in Postgres; null here only for unparseable Valor cells
   * (raw preserved in notes, issue logged, matchStatus='needs_review').
   */
  amount: number | null;
  /** expected_amount — contract/planilha value (reconciliation). */
  expectedAmount: number | null;
  dueDate: string | null;
  status: ChargeStatus;
  /**
   * status_source — 'sync' (pipeline-derived) vs 'rpc' (human/RPC-set, sticky
   * against re-sync; H2/decision #20). Optional in the domain type: the sheets
   * backend (normalize.ts) leaves it undefined ≙ 'sync'; the Supabase backend
   * always sets it from the column.
   */
  statusSource?: "sync" | "rpc";
  matchStatus: MatchStatus;
  /**
   * flags — gerar_mes / pipeline flags (`boxes_mismatch`, `no_metabase_data`,
   * `pro_rata`, `new_station`, …) replacing the sheet's cell colors. Optional:
   * undefined ≙ [] on the sheets backend; the Supabase backend reads the column.
   */
  flags?: string[];
  paymentMethod: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  /** linha_digitavel — normalized digits-only. */
  linhaDigitavel: string | null;
  notaFiscal: string | null;
  documentoNumero: string | null;
  issuerCnpj: string | null;
  source: IngestSource;
  /**
   * dedupe_key recipes: `enel:{enel_id}:{due_date}` | `edp:{uc}:{due_date}` |
   * `pag:{cadastro_id|'unidentified'}:{YYYY-MM|'na'}:{kind}` (2_Pagamentos;
   * `#n` suffixed on collision, issue logged).
   */
  dedupeKey: string;
  /** legacy_ref — {tab, rowNumber} sheet provenance. */
  legacyRef: { tab: string; rowNumber: number } | null;
  notes: string | null;
  raw: Record<string, string>;
}

/** eletron.charge_lines — rent/energy split inside ONE charge. */
export interface ChargeLine {
  id: string;
  chargeId: string;
  lineKind: ChargeLineKind;
  description: string | null;
  /** amount — negatives allowed (Hubees discounts). */
  amount: number;
  competencia: string | null;
  competenciaSource: CompetenciaSource | null;
}

/** eletron.charge_energy_details — 1:1 Faturas_ENEL / Faturas_EDP detail. */
export interface ChargeEnergyDetails {
  /** charge_id (PK). */
  chargeId: string;
  nf: string | null;
  /** tariff_c1..c6 — ENEL C1–C6 classification columns. */
  tariffC1: string | null;
  tariffC2: string | null;
  tariffC3: string | null;
  tariffC4: string | null;
  tariffC5: string | null;
  tariffC6: string | null;
  /** EDP variant. */
  classificacao: string | null;
  modalidade: string | null;
  tipoFornecimento: string | null;
  tusdKwh: number | null;
  tusdAmount: number | null;
  teKwh: number | null;
  teAmount: number | null;
  cip: number | null;
  subFaturamento: number | null;
  total: number | null;
  leituraAnterior: string | null;
  leituraAtual: string | null;
  autoDebit: AutoDebitStatus;
  autoDebitRegistration: string | null;
  /** fatura_drive_url — parsed from the =HYPERLINK link_fatura formula. */
  faturaDriveUrl: string | null;
  /**
   * fiscal_exported — sheet 'Financeiro Check'. Means "exported to the FISCAL
   * spreadsheet" (decision #21), NOT paid. Never drives charge.status.
   */
  fiscalExported: boolean;
  /** fiscal_exported_at — no timestamp in the sheet, so null from sync. */
  fiscalExportedAt: string | null;
}

/** eletron.receipts — one row per receipt PAGE. (No Phase 1 source yet.) */
export interface Receipt {
  id: string;
  documentId: string | null;
  pageNumber: number;
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
  matchStatus: MatchStatus;
  rawText: string | null;
}

/** eletron.payments — allocation of money to a charge. (No Phase 1 source yet.) */
export interface Payment {
  id: string;
  chargeId: string;
  /** receipt_id — NULLABLE: 'Pago' checkmarks without receipt exist. */
  receiptId: string | null;
  amount: number;
  paidAt: string | null;
  method: PaymentMethod | null;
  source: IngestSource;
  createdByEmail: string | null;
}

/** eletron.meter_readings — phone flow, mandatory photo. (Write flow is Phase 2.) */
export interface MeterReading {
  id: string;
  stationId: number;
  billingAccountId: string | null;
  /** name — editable label, default '{swap_station_id} - {address}' (C3). */
  name: string;
  readingDate: string;
  competencia: string;
  readingKwh: number;
  /** photo_document_id — MANDATORY photo (NOT NULL FK in Phase 2). */
  photoDocumentId: string;
  /** photo_taken_at — EXIF capture time, copied off documents.exif. */
  photoTakenAt: string | null;
  /** photo_gps — raw EXIF GPS object (jsonb), null when absent. */
  photoGps: unknown | null;
  /** photo_warnings — EXIF sanity warnings (stale/far-from-station, …). */
  photoWarnings: string[];
  readByEmail: string;
  notes: string | null;
  replacesReadingId: string | null;
  isSuperseded: boolean;
}

/**
 * charging.documents — Drive-backed file store (decision #17); no Supabase
 * Storage. One row per ingested file; `content_hash` (sha256) is the dedupe key.
 * Read directly via `supabaseForUser` in server components — outside the
 * Repository interface (H3).
 */
export interface Document {
  id: string;
  kind: DocumentKind;
  source: IngestSource;
  /** drive_file_id — the Drive object id (the store). */
  driveFileId: string;
  /** drive_folder_kind — which configured Drive folder it lives in. */
  driveFolderKind: DriveFolderKind;
  /** web_view_link — Drive preview URL (served via the session-checked proxy). */
  webViewLink: string | null;
  originalFilename: string | null;
  /** content_hash — sha256, unique; THE dedupe key. */
  contentHash: string;
  mimeType: string | null;
  byteSize: number | null;
  pageCount: number | null;
  /** exif — raw EXIF jsonb (meter columns are copied off it). */
  exif: unknown | null;
  processingStatus: DocProcessingStatus;
  processingError: string | null;
  processedAt: string | null;
  uploadedByEmail: string | null;
}

/** eletron.rent_adjustments — 3_Reajustes. */
export interface RentAdjustment {
  id: string;
  contractId: string | null;
  /** Not a Postgres column — 3_Reajustes keys rows by station, kept for review. */
  stationId: number | null;
  negotiatedOn: string | null;
  indexType: AdjustmentIndex;
  indexPct: number | null;
  oldAmount: number | null;
  newAmount: number | null;
  effectiveFrom: string | null;
  status: AdjustmentStatus;
  notes: string | null;
  raw: Record<string, string>;
}

/** eletron.alerts — computed in TS in Phase 1 (evaluateAlerts), DB rows in Phase 2. */
export interface Alert {
  /** Deterministic: equals dedupeKey in Phase 1. */
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  stationId: number | null;
  billingAccountId: string | null;
  chargeId: string | null;
  /** dedupe_key — e.g. 'overdue:{accountId}:{dueDate}'. */
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: AlertStatus;
}

/** One normalization problem — never silently dropped (appendix §5.1). */
export interface NormalizationIssue {
  /** Source tab name, e.g. 'enel_data'. */
  tab: string;
  /** 1-based sheet row number (header = row 1). */
  rowNumber: number;
  column: string | null;
  code:
    | "invalid_station_id"
    | "invalid_cadastro_id"
    | "unknown_bill_status"
    | "unknown_auto_debit"
    | "unknown_enum_literal"
    | "unparseable_money"
    | "unparseable_date"
    | "unparseable_competencia"
    | "duplicate_dedupe_key"
    | "missing_key"
    | "missing_account"
    | "zip_length_mismatch"
    | "invalid_value";
  message: string;
  rawValue: string | null;
}

/** The whole normalized world for one sheet snapshot. */
export interface DomainSnapshot {
  stations: Station[];
  counterparties: Counterparty[];
  contracts: Contract[];
  billingAccounts: BillingAccount[];
  utilityAccountStates: UtilityAccountState[];
  monthlyConsumption: MonthlyConsumption[];
  charges: Charge[];
  chargeLines: ChargeLine[];
  chargeEnergyDetails: ChargeEnergyDetails[];
  rentAdjustments: RentAdjustment[];
  issues: NormalizationIssue[];
}
