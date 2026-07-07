/**
 * Plain JSON-serializable shapes crossing the server → client boundary of
 * /estacoes. Assembled once server-side (estacoes-data.ts) so the client
 * table never re-joins snapshot entities.
 */

import type {
  AutoDebitStatus,
  ChargeStatus,
  ContractType,
  StationStatus,
  UtilityBillStatus,
} from "@/lib/domain";

/** One row of the /estacoes table (StationRollup + server-side joins). */
export interface EstacaoRow {
  stationId: number;
  name: string | null;
  address: string | null;
  status: StationStatus | null;
  sources: { enel: number; edp: number; rent: number; thirdParty: number };
  worstBillStatus: UtilityBillStatus | null;
  /** 'Enel 12345: Vencida' lines for the per-account title tooltip. */
  billStatusDetail: string[];
  /** 'Sem contas' carried forward — staleness caveat must be shown. */
  hasCarriedForwardStatus: boolean;
  earliestOpenDueDate: string | null;
  lastBillingTotal: number | null;
  autoDebitAggregate: AutoDebitStatus | "parcial";
  rentStatusCurrentMonth: ChargeStatus | null;
  contractType: ContractType | null;
  valorMensal: number | null;
  boxCount: number | null;
  cadastroId: number | null;
  parceiro: string | null;
  /** min(scrapedAt) across the station's utility accounts. */
  freshness: string | null;
  /** Earliest scheduled ENEL shutdown in the next 7 days, if any. */
  shutdownDate: string | null;
  /** 'HH:mm–HH:mm' window when the alert payload carries it. */
  shutdownWindow: string | null;
  /** Alert types active for this station (quick-filter chips). */
  alertTypes: string[];
  latitude: number | null;
  longitude: number | null;
  sourceCreatedAt: string | null;
  frDivergencePct: number | null;
  frDivergenceMonth: string | null;
}

/** Aggregates for the 7-card KPI strip. */
export interface EstacoesKpis {
  ativas: number;
  totalEstacoes: number;
  /** Installations with billStatus 'vencida' (count + R$ sum of last bills). */
  vencidasCount: number;
  vencidasTotal: number;
  /** due_soon_no_auto_debit alerts (installations). */
  venceSemDaCount: number;
  /** Installations with auto-debit 'Não cadastrado'. */
  semDaCount: number;
  /** Rent charges of the current competência still open (count + R$ sum). */
  rentPendingCount: number;
  rentPendingTotal: number;
  enelMaxScrapedAt: string | null;
  edpMaxScrapedAt: string | null;
  /** Sum of the review queues (links to /revisao). */
  emRevisaoCount: number;
}

/** ?filtro= deep-link values (KPI cards preselect a chip or facet). */
export type FiltroParam =
  | "ativas"
  | "vencidas"
  | "venceSemDA"
  | "semDA"
  | "scraperParado"
  | "novas"
  | "negociadas"
  | "desligamento"
  | "aluguelPendente";
