/**
 * Domain enums mirroring the future Supabase `eletron` schema
 * (docs/superpowers/specs/appendix/data-model.md §1).
 *
 * Plain string-literal unions + `as const` maps so values are usable both as
 * types and as runtime lists (filters, badges, exhaustive switches).
 */

/** eletron.station_status — also used for contract Status_Locacao. */
export const STATION_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  DECOMMISSIONED: "DECOMMISSIONED",
  PRE_INSTALLATION: "PRE_INSTALLATION",
} as const;
export type StationStatus = (typeof STATION_STATUS)[keyof typeof STATION_STATUS];

/** eletron.account_type */
export const ACCOUNT_TYPE = {
  rent: "rent",
  energyEnel: "energy_enel",
  energyEdp: "energy_edp",
  thirdParty: "third_party",
} as const;
export type AccountType = (typeof ACCOUNT_TYPE)[keyof typeof ACCOUNT_TYPE];

/** eletron.contract_type — pricing modality (1_Cadastro Tipo_Contrato). */
export const CONTRACT_TYPE = {
  porBox: "por_box",
  fixo: "fixo",
  porBoxMinimo: "por_box_minimo",
  gratuito: "gratuito",
  casaVammo: "casa_vammo",
} as const;
export type ContractType = (typeof CONTRACT_TYPE)[keyof typeof CONTRACT_TYPE];

/** eletron.payment_method */
export const PAYMENT_METHOD = {
  pix: "pix",
  boletoCelular: "boleto_celular",
  boletoEmail: "boleto_email",
  transferencia: "transferencia",
  debitoAutomatico: "debito_automatico",
  outro: "outro",
} as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** eletron.charge_status — superset of 2_Pagamentos Status_Pgto + portal states. */
export const CHARGE_STATUS = {
  pendente: "pendente",
  boletoRecebido: "boleto_recebido",
  /** Auto-matched by the comprovante matcher; awaiting human `confirm_charge` (Phase 2, decision #24). */
  conciliado: "conciliado",
  pago: "pago",
  atrasado: "atrasado",
  antecipado: "antecipado",
  emCompensacao: "em_compensacao",
  negociada: "negociada",
  cancelada: "cancelada",
  naoAplicavel: "nao_aplicavel",
} as const;
export type ChargeStatus = (typeof CHARGE_STATUS)[keyof typeof CHARGE_STATUS];

/** eletron.charge_kind (2_Pagamentos Tipo de Cobrança). */
export const CHARGE_KIND = {
  aluguel: "aluguel",
  energia: "energia",
  aluguelEnergia: "aluguel_energia",
} as const;
export type ChargeKind = (typeof CHARGE_KIND)[keyof typeof CHARGE_KIND];

/** eletron.charge_line_kind */
export const CHARGE_LINE_KIND = {
  aluguel: "aluguel",
  energia: "energia",
  desconto: "desconto",
  multaJuros: "multa_juros",
  outro: "outro",
} as const;
export type ChargeLineKind = (typeof CHARGE_LINE_KIND)[keyof typeof CHARGE_LINE_KIND];

/** eletron.utility_bill_status — normalized portal literal ("Paga", "Sem contas", ...). */
export const UTILITY_BILL_STATUS = {
  paga: "paga",
  pendente: "pendente",
  aVencer: "a_vencer",
  vencida: "vencida",
  semContas: "sem_contas",
  emCompensacao: "em_compensacao",
  faturaNegociada: "fatura_negociada",
  na: "na",
} as const;
export type UtilityBillStatus = (typeof UTILITY_BILL_STATUS)[keyof typeof UTILITY_BILL_STATUS];

/** eletron.auto_debit_status — normalized "Cadastrado"/"Não cadastrado"/"Nao Cadastrado". */
export const AUTO_DEBIT_STATUS = {
  cadastrado: "cadastrado",
  naoCadastrado: "nao_cadastrado",
  desconhecido: "desconhecido",
} as const;
export type AutoDebitStatus = (typeof AUTO_DEBIT_STATUS)[keyof typeof AUTO_DEBIT_STATUS];

/** eletron.match_status — station↔account attribution confidence. */
export const MATCH_STATUS = {
  autoMatched: "auto_matched",
  manuallyMatched: "manually_matched",
  unmatched: "unmatched",
  needsReview: "needs_review",
  rejected: "rejected",
  superseded: "superseded",
} as const;
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

/** eletron.adjustment_index (3_Reajustes Índice). */
export const ADJUSTMENT_INDEX = {
  igpm: "igpm",
  ipca: "ipca",
  inpc: "inpc",
  outro: "outro",
} as const;
export type AdjustmentIndex = (typeof ADJUSTMENT_INDEX)[keyof typeof ADJUSTMENT_INDEX];

/** eletron.adjustment_status */
export const ADJUSTMENT_STATUS = {
  pendente: "pendente",
  negociando: "negociando",
  aplicado: "aplicado",
  recusado: "recusado",
} as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUS)[keyof typeof ADJUSTMENT_STATUS];

/** eletron.ingest_source */
export const INGEST_SOURCE = {
  scraperEnel: "scraper_enel",
  scraperEdp: "scraper_edp",
  emailAi: "email_ai",
  drivePoll: "drive_poll",
  manual: "manual",
  metabaseSync: "metabase_sync",
  sheetBackfill: "sheet_backfill",
  /** Rent charges generated in-app by the `gerar_mes` RPC (Phase 2). */
  gerarMes: "gerar_mes",
  /** Auto-matched payments written by the comprovante pipeline (chunk upload / daily sweep). */
  autoMatch: "auto_match",
  /** Files uploaded through an in-app upload route (Phase 2). */
  appUpload: "app_upload",
} as const;
export type IngestSource = (typeof INGEST_SOURCE)[keyof typeof INGEST_SOURCE];

/** eletron.receipt_type */
export const RECEIPT_TYPE = {
  pix: "pix",
  ted: "ted",
  debitoAutomatico: "debito_automatico",
  boletoBarcode: "boleto_barcode",
  outro: "outro",
} as const;
export type ReceiptType = (typeof RECEIPT_TYPE)[keyof typeof RECEIPT_TYPE];

/** eletron.alert_status */
export const ALERT_STATUS = {
  open: "open",
  acknowledged: "acknowledged",
  resolved: "resolved",
  muted: "muted",
} as const;
export type AlertStatus = (typeof ALERT_STATUS)[keyof typeof ALERT_STATUS];

/** eletron.competencia_source — how a charge's competência was determined. */
export const COMPETENCIA_SOURCE = {
  explicit: "explicit",
  inferredDueDate: "inferred_due_date",
  inferredFilename: "inferred_filename",
  inferredIssuerRule: "inferred_issuer_rule",
  manual: "manual",
  unknown: "unknown",
} as const;
export type CompetenciaSource = (typeof COMPETENCIA_SOURCE)[keyof typeof COMPETENCIA_SOURCE];

/** eletron.alerts.alert_type CHECK list (appendix §2.10). */
export const ALERT_TYPE = {
  overdueBill: "overdue_bill",
  dueSoonNoAutoDebit: "due_soon_no_auto_debit",
  noAutoDebit: "no_auto_debit",
  newInstallation: "new_installation",
  scraperStale: "scraper_stale",
  negotiatedInvoice: "negotiated_invoice",
  scheduledShutdown: "scheduled_shutdown",
  stationWithoutContract: "station_without_contract",
  contractWithoutStation: "contract_without_station",
  unmatchedCharge: "unmatched_charge",
  unmatchedReceipt: "unmatched_receipt",
  unmatchedAccount: "unmatched_account",
  meterVsBillDiscrepancy: "meter_vs_bill_discrepancy",
  missingMeterReading: "missing_meter_reading",
  valueMismatch: "value_mismatch",
  contractExpiring: "contract_expiring",
  /** Phase 2 (M2) self-alerts — emitted by jobs/routes, not evaluateAlerts(). */
  manualBillSheetAppendFailed: "manual_bill_sheet_append_failed",
  encryptedComprovante: "encrypted_comprovante",
  sheetSyncStale: "sheet_sync_stale",
  /** Phase 2.5 (R4): rent_manual contract without the month's rent charge. */
  manualRentReminder: "manual_rent_reminder",
  /** Phase 2.5: pix/transferência rent generated but unpaid after the 5th. */
  rentPaymentDue: "rent_payment_due",
} as const;
export type AlertType = (typeof ALERT_TYPE)[keyof typeof ALERT_TYPE];

export const ALERT_SEVERITY = {
  info: "info",
  warning: "warning",
  critical: "critical",
} as const;
export type AlertSeverity = (typeof ALERT_SEVERITY)[keyof typeof ALERT_SEVERITY];

/** eletron.counterparties.kind CHECK list. */
export const COUNTERPARTY_KIND = {
  locador: "locador",
  condominio: "condominio",
  intermediario: "intermediario",
  spe: "spe",
  concessionaria: "concessionaria",
  outro: "outro",
} as const;
export type CounterpartyKind = (typeof COUNTERPARTY_KIND)[keyof typeof COUNTERPARTY_KIND];

/** charging.document_kind — what an ingested document is. */
export const DOCUMENT_KIND = {
  faturaEnel: "fatura_enel",
  faturaEdp: "fatura_edp",
  boletoAluguel: "boleto_aluguel",
  boletoCondominio: "boleto_condominio",
  notaDebito: "nota_debito",
  nfse: "nfse",
  comprovante: "comprovante",
  contrato: "contrato",
  fotoMedidor: "foto_medidor",
  outro: "outro",
} as const;
export type DocumentKind = (typeof DOCUMENT_KIND)[keyof typeof DOCUMENT_KIND];

/** charging.drive_folder_kind — which Drive folder a document lives in (decision #17). */
export const DRIVE_FOLDER_KIND = {
  meterPhotos: "meter_photos",
  comprovantes: "comprovantes",
  bills: "bills",
  other: "other",
} as const;
export type DriveFolderKind = (typeof DRIVE_FOLDER_KIND)[keyof typeof DRIVE_FOLDER_KIND];

/** charging.doc_processing_status — pipeline state of an ingested document. */
export const DOC_PROCESSING_STATUS = {
  pending: "pending",
  processed: "processed",
  needsReview: "needs_review",
  failed: "failed",
} as const;
export type DocProcessingStatus = (typeof DOC_PROCESSING_STATUS)[keyof typeof DOC_PROCESSING_STATUS];
