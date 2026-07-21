/**
 * Plain JSON-serializable row shapes for the /energia screens.
 * Built server-side in app/(app)/energia/page.tsx from the domain snapshot;
 * the client tables never touch raw sheet strings.
 */

import type {
  AutoDebitStatus,
  IngestSource,
  MatchStatus,
  UtilityBillStatus,
} from "@/lib/domain";
import type { PaymentLinkSummary } from "@/lib/data/payment-links.shared";
import type { CicloStage } from "@/lib/energia/ciclo";

/** Energy-provider subset of AccountType. */
export type EnergyProvider = "energy_enel" | "energy_edp";

/**
 * Energy billing account WITH its real charging uuid — the manual-bill RPC and
 * the meter-reading account picker take the uuid, but the Repository hides it
 * (domain ids are deterministic strings). Built server-side by
 * `readEnergyAccounts()` (energy-accounts.ts) and passed to the client dialog.
 * Plain/client-safe (no `server-only`) so client components may import the type.
 */
export interface EnergyAccountOption {
  /** charging.billing_accounts.id (uuid). */
  id: string;
  provider: EnergyProvider;
  /** enel_id or edp_uc. */
  installationKey: string;
  stationId: number | null;
  stationName: string | null;
  address: string | null;
  meterReadingRequired: boolean;
}

/**
 * One fatura in the per-installation history drawer (Q11) — the account's last
 * competências with OUR lifecycle stage + the Drive PDF link.
 */
export interface InstalacaoHistoryEntry {
  chargeId: string;
  /** 'YYYY-MM-01' or null. */
  competencia: string | null;
  dueDate: string | null;
  amount: number | null;
  ciclo: CicloStage;
  /** Drive link parsed from the sheet's =HYPERLINK link_fatura. */
  pdfUrl: string | null;
  /** Linked charging.payments coverage — null when none. */
  payment: PaymentLinkSummary | null;
}

/** One row per enel_id / UC in the "Instalações" tab. */
export interface InstalacaoRow {
  accountId: string;
  provider: EnergyProvider;
  /** enel_id or edp_uc. */
  installationKey: string;
  stationId: number | null;
  matchStatus: MatchStatus;
  /**
   * Q11 "Ciclo" — OUR lifecycle stage of the latest bill (vs the portal's
   * billStatus): 1 Detectada · 2 Analisada · 3 Enviada ao fiscal · 4 Paga.
   * Null when the account has no bill at all.
   */
  ciclo: CicloStage | null;
  /** Last ~12 competências, latest first (history drawer). */
  history: InstalacaoHistoryEntry[];
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  billStatus: UtilityBillStatus | null;
  /** 'Sem contas' carries stale status forward — always show the caveat. */
  isStatusCarriedForward: boolean;
  lastBilling: number | null;
  dueDate: string | null;
  autoDebit: AutoDebitStatus;
  autoDebitRegistration: string | null;
  accountEmail: string | null;
  /** Count of negotiated-invoice entries on the portal. */
  negotiatedCount: number;
  /** Parsed 'YYYY-MM' competências of the negotiated invoices. */
  negotiatedCompetencias: string[];
  shutdownDate: string | null;
  firstSeenAt: string | null;
  scrapedAt: string | null;
  /** (billed − recorded) / billed × 100 for the latest month with both. */
  frDivergencePct: number | null;
  /** 'YYYY-MM' the divergence refers to. */
  frDivergenceMonth: string | null;
  lat: number | null;
  lon: number | null;
}

/** One row per energy invoice (Faturas_ENEL + Faturas_EDP unified). */
export interface FaturaRow {
  chargeId: string;
  provider: EnergyProvider;
  installationKey: string;
  stationId: number | null;
  matchStatus: MatchStatus;
  /** Ingest provenance — `manual` renders a "Manual" source badge. */
  source: IngestSource;
  /** 'YYYY-MM-01' or null. */
  competencia: string | null;
  dueDate: string | null;
  amount: number | null;
  nf: string | null;
  tusdKwh: number | null;
  tusdAmount: number | null;
  teKwh: number | null;
  teAmount: number | null;
  cip: number | null;
  total: number | null;
  leituraAnterior: string | null;
  leituraAtual: string | null;
  /** ENEL C1–C6 joined, or EDP classificação · modalidade. */
  tariffClass: string | null;
  /**
   * Q11 "Ciclo" — OUR lifecycle stage of THIS fatura (same derivation as the
   * Instalações tab): 1 Detectada · 2 Analisada · 3 Enviada ao fiscal · 4 Paga.
   * Fatura rows are parsed charges, so in practice ≥ 2.
   */
  ciclo: CicloStage;
  /** Status do portal da concessionária (billStatus da conta) — exibido ao lado do Ciclo. */
  billStatus: UtilityBillStatus | null;
  fiscalExported: boolean;
  /** Fatura legada encerrada (#71) — comprovante dispensado (badge na coluna Comprovante). */
  comprovanteWaived: boolean;
  /** Débito automático of the installation (R1 — from utility state). */
  autoDebit: AutoDebitStatus;
  autoDebitRegistration: string | null;
  /** Installation-level last receipt (state.ultimoComprovante presence). */
  hasComprovante: boolean;
  /** Parsed registration date of that receipt, when available. */
  comprovanteDate: string | null;
  /** Linked charging.payments coverage (R1) — null when none / sheets mode. */
  payment: PaymentLinkSummary | null;
  faturaDriveUrl: string | null;
}
