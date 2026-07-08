/**
 * Repository interface + the Phase 1 SheetSnapshotRepository.
 *
 * Screens depend only on the Repository interface; this implementation serves
 * everything from one normalized in-memory snapshot (raw tabs → normalize →
 * derive). Phase 2 swaps in a Supabase-backed implementation behind the same
 * interface.
 *
 * This module is runtime-agnostic (no Next.js / Node-only imports) so vitest
 * can instantiate SheetSnapshotRepository with any loader function. The
 * Next-cached wiring (React cache + unstable_cache + revalidateTag) lives in
 * repository.server.ts.
 */

import {
  ACCOUNT_TYPE,
  MATCH_STATUS,
  type AccountType,
  type Alert,
  type BillingAccount,
  type Charge,
  type ChargeEnergyDetails,
  type ChargeKind,
  type ChargeLine,
  type ChargeStatus,
  type Contract,
  type Counterparty,
  type DomainSnapshot,
  type MonthlyConsumption,
  type NormalizationIssue,
  type RentAdjustment,
  type Station,
  type UtilityAccountState,
} from "@/lib/domain";
import {
  evaluateAlerts,
  stationRollups,
  type StationRollup,
} from "@/lib/ingest/derive";
import { normalizeSnapshot } from "@/lib/ingest/normalize";
import type { RawTabs } from "@/lib/ingest/raw-tabs";

/** Snapshot + when it was loaded (freshness ribbon input). */
export interface LoadedSnapshot extends DomainSnapshot {
  fetchedAt: string;
}

export interface ChargesFilter {
  stationId?: number;
  billingAccountId?: string;
  accountType?: AccountType;
  kind?: ChargeKind;
  status?: ChargeStatus;
  /** 'YYYY-MM' prefix match on competencia. */
  competencia?: string;
  dueBefore?: string;
  dueAfter?: string;
  unmatchedOnly?: boolean;
}

/** One billing account with its scraper state and related data, for the 360°. */
export interface AccountWithState {
  account: BillingAccount;
  state: UtilityAccountState | null;
  counterparty: Counterparty | null;
  contract: Contract | null;
  charges: Charge[];
  consumption: MonthlyConsumption[];
}

/** Everything the /estacoes/[id] 360° screen needs in one object. */
export interface Station360 {
  station: Station;
  rollup: StationRollup;
  accounts: AccountWithState[];
  contracts: Contract[];
  charges: Charge[];
  chargeLines: ChargeLine[];
  energyDetails: ChargeEnergyDetails[];
  rentAdjustments: RentAdjustment[];
  alerts: Alert[];
}

export interface FreshnessInfo {
  /** Stalest scraper timestamp in the snapshot (the freshness ribbon). */
  minScrapedAt: string | null;
  maxScrapedAt: string | null;
  byProvider: {
    enel: { minScrapedAt: string | null; maxScrapedAt: string | null };
    edp: { minScrapedAt: string | null; maxScrapedAt: string | null };
  };
  /** When this snapshot was loaded from the source. */
  fetchedAt: string;
}

export interface Repository {
  getSnapshot(): Promise<LoadedSnapshot>;
  getStations(): Promise<StationRollup[]>;
  getStation(id: number): Promise<Station360 | null>;
  getCharges(filter?: ChargesFilter): Promise<Charge[]>;
  getAlerts(): Promise<Alert[]>;
  getContracts(): Promise<Contract[]>;
  /** Irregularity queue: unmatched/needs-review entities + join-gap alerts. */
  getIrregularities(): Promise<{
    unmatchedAccounts: BillingAccount[];
    unmatchedCharges: Charge[];
    issues: NormalizationIssue[];
    joinAlerts: Alert[];
  }>;
  getFreshness(): Promise<FreshnessInfo>;
}

/**
 * Backend-agnostic base: every read method derives from ONE `LoadedSnapshot`
 * (normalize → derive), memoized per instance. Subclasses only implement
 * `loadSnapshot()` — the sheets backend normalizes raw tabs, the Supabase
 * backend assembles the snapshot from the `charging` schema. This is what
 * makes the two backends produce identical shapes (the derived logic —
 * stationRollups/evaluateAlerts/filters — lives here, once).
 */
export abstract class SnapshotRepository implements Repository {
  protected snapshotPromise: Promise<LoadedSnapshot> | null = null;

  constructor(protected readonly clock: () => Date = () => new Date()) {}

  /** Load + assemble the snapshot; the base memoizes it per instance. */
  protected abstract loadSnapshot(): Promise<LoadedSnapshot>;

  getSnapshot(): Promise<LoadedSnapshot> {
    if (this.snapshotPromise === null) {
      this.snapshotPromise = this.loadSnapshot();
      // A failed load must not poison the memo forever.
      this.snapshotPromise.catch(() => {
        this.snapshotPromise = null;
      });
    }
    return this.snapshotPromise;
  }

  async getStations(): Promise<StationRollup[]> {
    const snapshot = await this.getSnapshot();
    return stationRollups(snapshot, this.clock());
  }

  async getStation(id: number): Promise<Station360 | null> {
    const snapshot = await this.getSnapshot();
    const station = snapshot.stations.find((s) => s.id === id);
    if (!station) return null;

    const now = this.clock();
    const rollup = stationRollups(snapshot, now).find(
      (r) => r.stationId === id,
    ) as StationRollup;

    const accounts = snapshot.billingAccounts.filter((a) => a.stationId === id);
    const accountIds = new Set(accounts.map((a) => a.id));
    const contracts = snapshot.contracts.filter((c) => c.stationId === id);
    const contractById = new Map(snapshot.contracts.map((c) => [c.id, c]));
    const counterpartyById = new Map(
      snapshot.counterparties.map((c) => [c.id, c]),
    );
    const stateByAccount = new Map(
      snapshot.utilityAccountStates.map((s) => [s.billingAccountId, s]),
    );
    const charges = snapshot.charges.filter(
      (c) =>
        c.stationId === id ||
        (c.billingAccountId !== null && accountIds.has(c.billingAccountId)),
    );
    const chargeIds = new Set(charges.map((c) => c.id));

    return {
      station,
      rollup,
      accounts: accounts.map((account) => ({
        account,
        state: stateByAccount.get(account.id) ?? null,
        counterparty: account.counterpartyId
          ? (counterpartyById.get(account.counterpartyId) ?? null)
          : null,
        contract: account.contractId
          ? (contractById.get(account.contractId) ?? null)
          : null,
        charges: charges.filter((c) => c.billingAccountId === account.id),
        consumption: snapshot.monthlyConsumption.filter(
          (m) => m.billingAccountId === account.id,
        ),
      })),
      contracts,
      charges,
      chargeLines: snapshot.chargeLines.filter((l) => chargeIds.has(l.chargeId)),
      energyDetails: snapshot.chargeEnergyDetails.filter((d) =>
        chargeIds.has(d.chargeId),
      ),
      rentAdjustments: snapshot.rentAdjustments.filter(
        (r) => r.stationId === id,
      ),
      alerts: evaluateAlerts(snapshot, now).filter((a) => a.stationId === id),
    };
  }

  async getCharges(filter: ChargesFilter = {}): Promise<Charge[]> {
    const snapshot = await this.getSnapshot();
    const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));
    return snapshot.charges.filter((charge) => {
      if (filter.stationId !== undefined && charge.stationId !== filter.stationId) {
        return false;
      }
      if (
        filter.billingAccountId !== undefined &&
        charge.billingAccountId !== filter.billingAccountId
      ) {
        return false;
      }
      if (filter.accountType !== undefined) {
        const account = charge.billingAccountId
          ? accountById.get(charge.billingAccountId)
          : undefined;
        if (account?.accountType !== filter.accountType) return false;
      }
      if (filter.kind !== undefined && charge.kind !== filter.kind) return false;
      if (filter.status !== undefined && charge.status !== filter.status) {
        return false;
      }
      if (
        filter.competencia !== undefined &&
        !(charge.competencia ?? "").startsWith(filter.competencia)
      ) {
        return false;
      }
      if (filter.dueBefore !== undefined) {
        if (charge.dueDate === null || charge.dueDate >= filter.dueBefore) {
          return false;
        }
      }
      if (filter.dueAfter !== undefined) {
        if (charge.dueDate === null || charge.dueDate <= filter.dueAfter) {
          return false;
        }
      }
      if (
        filter.unmatchedOnly === true &&
        charge.matchStatus !== MATCH_STATUS.unmatched &&
        charge.matchStatus !== MATCH_STATUS.needsReview
      ) {
        return false;
      }
      return true;
    });
  }

  async getAlerts(): Promise<Alert[]> {
    const snapshot = await this.getSnapshot();
    return evaluateAlerts(snapshot, this.clock());
  }

  async getContracts(): Promise<Contract[]> {
    const snapshot = await this.getSnapshot();
    return snapshot.contracts;
  }

  async getIrregularities(): Promise<{
    unmatchedAccounts: BillingAccount[];
    unmatchedCharges: Charge[];
    issues: NormalizationIssue[];
    joinAlerts: Alert[];
  }> {
    const snapshot = await this.getSnapshot();
    const alerts = evaluateAlerts(snapshot, this.clock());
    return {
      unmatchedAccounts: snapshot.billingAccounts.filter(
        (a) =>
          a.matchStatus === MATCH_STATUS.unmatched ||
          a.matchStatus === MATCH_STATUS.needsReview,
      ),
      unmatchedCharges: snapshot.charges.filter(
        (c) =>
          c.matchStatus === MATCH_STATUS.unmatched ||
          c.matchStatus === MATCH_STATUS.needsReview,
      ),
      issues: snapshot.issues,
      joinAlerts: alerts.filter(
        (a) =>
          a.alertType === "station_without_contract" ||
          a.alertType === "contract_without_station",
      ),
    };
  }

  async getFreshness(): Promise<FreshnessInfo> {
    const snapshot = await this.getSnapshot();
    const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));

    function minMax(states: UtilityAccountState[]): {
      minScrapedAt: string | null;
      maxScrapedAt: string | null;
    } {
      const times = states
        .map((s) => s.scrapedAt)
        .filter((t): t is string => t !== null)
        .sort();
      return {
        minScrapedAt: times[0] ?? null,
        maxScrapedAt: times[times.length - 1] ?? null,
      };
    }

    const all = snapshot.utilityAccountStates;
    const enel = all.filter(
      (s) =>
        accountById.get(s.billingAccountId)?.accountType ===
        ACCOUNT_TYPE.energyEnel,
    );
    const edp = all.filter(
      (s) =>
        accountById.get(s.billingAccountId)?.accountType ===
        ACCOUNT_TYPE.energyEdp,
    );
    return {
      ...minMax(all),
      byProvider: { enel: minMax(enel), edp: minMax(edp) },
      fetchedAt: snapshot.fetchedAt,
    };
  }
}

/**
 * Phase 1 implementation over a raw-tabs loader (live Sheets or xlsx
 * fixtures — injected). Normalization/derivation run once per instance and
 * are memoized; instance lifetime/caching is the caller's concern
 * (repository.server.ts holds the Next.js wiring).
 */
export class SheetSnapshotRepository extends SnapshotRepository {
  constructor(
    private readonly loadRaw: () => Promise<RawTabs>,
    clock: () => Date = () => new Date(),
  ) {
    super(clock);
  }

  protected async loadSnapshot(): Promise<LoadedSnapshot> {
    const raw = await this.loadRaw();
    const snapshot = normalizeSnapshot(raw);
    return { ...snapshot, fetchedAt: this.clock().toISOString() };
  }
}
