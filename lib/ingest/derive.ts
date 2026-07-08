/**
 * derive.ts — pure derivations over a DomainSnapshot: per-station rollups for
 * the /estacoes table and the 7 alert rules (+ 2 irregularity outer joins)
 * that replace the n8n watchdogs.
 *
 * Everything takes `now` as a parameter — no Date.now() anywhere — so tests
 * are deterministic. No raw sheet strings here: normalize.ts already turned
 * everything into typed fields.
 */

import {
  ACCOUNT_TYPE,
  ALERT_SEVERITY,
  ALERT_STATUS,
  ALERT_TYPE,
  AUTO_DEBIT_STATUS,
  CHARGE_KIND,
  CHARGE_STATUS,
  STATION_STATUS,
  UTILITY_BILL_STATUS,
  type Alert,
  type AutoDebitStatus,
  type BillingAccount,
  type ChargeStatus,
  type DomainSnapshot,
  type Station,
  type UtilityAccountState,
  type UtilityBillStatus,
} from "@/lib/domain";

// ═══════════════════════════════════════════════════════════════════════════
// Date arithmetic on ISO strings (UTC-midnight based, deterministic)
// ═══════════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;

function isoDateToUtcMs(isoDate: string): number {
  // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss[±off]' — date part only.
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function nowUtcDateMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Whole days from `from` (ISO) to `now` — positive when `from` is in the past. */
export function daysSince(isoDate: string, now: Date): number {
  return Math.floor((nowUtcDateMs(now) - isoDateToUtcMs(isoDate)) / DAY_MS);
}

/** Whole days from `now` until `isoDate` — positive when in the future. */
export function daysUntil(isoDate: string, now: Date): number {
  return Math.floor((isoDateToUtcMs(isoDate) - nowUtcDateMs(now)) / DAY_MS);
}

/** 'YYYY-MM' of `now` (UTC), optionally shifted by whole months. */
export function monthOf(now: Date, shiftMonths = 0): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + shiftMonths;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Station rollups
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Worst-first severity order for the energy bill status rollup:
 * vencida > pendente > a_vencer > em_compensacao > fatura_negociada >
 * sem_contas > paga > na.
 */
export const BILL_STATUS_SEVERITY: Record<UtilityBillStatus, number> = {
  [UTILITY_BILL_STATUS.vencida]: 7,
  [UTILITY_BILL_STATUS.pendente]: 6,
  [UTILITY_BILL_STATUS.aVencer]: 5,
  [UTILITY_BILL_STATUS.emCompensacao]: 4,
  [UTILITY_BILL_STATUS.faturaNegociada]: 3,
  [UTILITY_BILL_STATUS.semContas]: 2,
  [UTILITY_BILL_STATUS.paga]: 1,
  [UTILITY_BILL_STATUS.na]: 0,
};

const OPEN_BILL_STATUSES: ReadonlySet<UtilityBillStatus> = new Set([
  UTILITY_BILL_STATUS.vencida,
  UTILITY_BILL_STATUS.pendente,
  UTILITY_BILL_STATUS.aVencer,
  UTILITY_BILL_STATUS.emCompensacao,
  UTILITY_BILL_STATUS.faturaNegociada,
]);

const OPEN_CHARGE_STATUSES: ReadonlySet<ChargeStatus> = new Set([
  CHARGE_STATUS.pendente,
  CHARGE_STATUS.boletoRecebido,
  CHARGE_STATUS.atrasado,
  CHARGE_STATUS.emCompensacao,
  CHARGE_STATUS.negociada,
]);

export interface StationRollup {
  stationId: number;
  station: Station;
  /** Counts by source, for the source chips. */
  sources: {
    enel: number;
    edp: number;
    rent: number;
    thirdParty: number;
  };
  /** Worst energy bill status across the station's utility accounts. */
  worstBillStatus: UtilityBillStatus | null;
  /** Earliest open due date (utility states + open charges). */
  earliestOpenDueDate: string | null;
  /** Sum of last_billing across utility accounts. */
  lastBillingTotal: number | null;
  /** cadastrado | nao_cadastrado | parcial | desconhecido across accounts. */
  autoDebitAggregate: AutoDebitStatus | "parcial";
  /** Status of the current-month rent charge(s), null when none. */
  rentStatusCurrentMonth: ChargeStatus | null;
  /** min(scrapedAt) across the station's utility accounts. */
  freshness: string | null;
  /** Any state row carrying a stale 'Sem contas' status forward. */
  hasCarriedForwardStatus: boolean;
  /**
   * F vs R divergence of the latest month that has both, summed across the
   * station's ENEL accounts: (billed - recorded) / billed * 100.
   */
  frDivergencePct: number | null;
  /** Competência ('YYYY-MM') the divergence refers to. */
  frDivergenceMonth: string | null;
}

/** Per-station aggregation feeding the /estacoes table. */
export function stationRollups(
  snapshot: DomainSnapshot,
  now: Date,
): StationRollup[] {
  const accountsByStation = new Map<number, BillingAccount[]>();
  for (const account of snapshot.billingAccounts) {
    if (account.stationId === null) continue;
    const list = accountsByStation.get(account.stationId) ?? [];
    list.push(account);
    accountsByStation.set(account.stationId, list);
  }
  const stateByAccount = new Map<string, UtilityAccountState>();
  for (const state of snapshot.utilityAccountStates) {
    stateByAccount.set(state.billingAccountId, state);
  }
  const chargesByAccount = new Map<string, DomainSnapshot["charges"]>();
  for (const charge of snapshot.charges) {
    if (charge.billingAccountId === null) continue;
    const list = chargesByAccount.get(charge.billingAccountId) ?? [];
    list.push(charge);
    chargesByAccount.set(charge.billingAccountId, list);
  }
  const consumptionByAccount = new Map<string, DomainSnapshot["monthlyConsumption"]>();
  for (const mc of snapshot.monthlyConsumption) {
    const list = consumptionByAccount.get(mc.billingAccountId) ?? [];
    list.push(mc);
    consumptionByAccount.set(mc.billingAccountId, list);
  }

  const currentMonth = monthOf(now);

  return snapshot.stations.map((station) => {
    const accounts = accountsByStation.get(station.id) ?? [];
    const utilityAccounts = accounts.filter(
      (a) =>
        a.accountType === ACCOUNT_TYPE.energyEnel ||
        a.accountType === ACCOUNT_TYPE.energyEdp,
    );
    const states = utilityAccounts
      .map((a) => stateByAccount.get(a.id))
      .filter((s): s is UtilityAccountState => s !== undefined);

    // Worst-of bill status.
    let worstBillStatus: UtilityBillStatus | null = null;
    for (const s of states) {
      if (s.billStatus === null) continue;
      if (
        worstBillStatus === null ||
        BILL_STATUS_SEVERITY[s.billStatus] > BILL_STATUS_SEVERITY[worstBillStatus]
      ) {
        worstBillStatus = s.billStatus;
      }
    }

    // Earliest open due date: open utility states + open charges.
    const dueDates: string[] = [];
    for (const s of states) {
      if (s.dueDate && s.billStatus && OPEN_BILL_STATUSES.has(s.billStatus)) {
        dueDates.push(s.dueDate);
      }
    }
    for (const account of accounts) {
      for (const charge of chargesByAccount.get(account.id) ?? []) {
        if (charge.dueDate && OPEN_CHARGE_STATUSES.has(charge.status)) {
          dueDates.push(charge.dueDate);
        }
      }
    }
    const earliestOpenDueDate =
      dueDates.length > 0 ? dueDates.sort()[0] : null;

    // Sum of last bills.
    const billings = states
      .map((s) => s.lastBilling)
      .filter((v): v is number => v !== null);
    const lastBillingTotal =
      billings.length > 0
        ? Math.round(billings.reduce((a, b) => a + b, 0) * 100) / 100
        : null;

    // Auto-debit aggregate.
    const autoDebits = states.map((s) => s.autoDebit);
    const anyCad = autoDebits.includes(AUTO_DEBIT_STATUS.cadastrado);
    const anyNao = autoDebits.includes(AUTO_DEBIT_STATUS.naoCadastrado);
    const autoDebitAggregate: StationRollup["autoDebitAggregate"] =
      anyCad && anyNao
        ? "parcial"
        : anyCad
          ? AUTO_DEBIT_STATUS.cadastrado
          : anyNao
            ? AUTO_DEBIT_STATUS.naoCadastrado
            : AUTO_DEBIT_STATUS.desconhecido;

    // Rent status of the current month (worst wins: pendente over pago).
    let rentStatusCurrentMonth: ChargeStatus | null = null;
    for (const account of accounts) {
      if (
        account.accountType !== ACCOUNT_TYPE.rent &&
        account.accountType !== ACCOUNT_TYPE.thirdParty
      ) {
        continue;
      }
      for (const charge of chargesByAccount.get(account.id) ?? []) {
        if (
          charge.kind !== CHARGE_KIND.aluguel &&
          charge.kind !== CHARGE_KIND.aluguelEnergia
        ) {
          continue;
        }
        if (!charge.competencia?.startsWith(currentMonth)) continue;
        if (rentStatusCurrentMonth === null) {
          rentStatusCurrentMonth = charge.status;
        } else if (
          rentStatusCurrentMonth === CHARGE_STATUS.pago &&
          charge.status !== CHARGE_STATUS.pago
        ) {
          rentStatusCurrentMonth = charge.status;
        }
      }
    }

    // Freshness: min scrapedAt (the stalest account defines the station).
    const scrapes = states
      .map((s) => s.scrapedAt)
      .filter((v): v is string => v !== null)
      .sort();
    const freshness = scrapes.length > 0 ? scrapes[0] : null;

    // F/R divergence, latest month with both values (summed across accounts).
    const enelAccountIds = new Set(
      utilityAccounts
        .filter((a) => a.accountType === ACCOUNT_TYPE.energyEnel)
        .map((a) => a.id),
    );
    const byMonth = new Map<string, { billed: number; recorded: number }>();
    for (const accountId of enelAccountIds) {
      for (const mc of consumptionByAccount.get(accountId) ?? []) {
        if (mc.kwhBilled === null || mc.kwhRecorded === null) continue;
        const key = mc.competencia.slice(0, 7);
        const entry = byMonth.get(key) ?? { billed: 0, recorded: 0 };
        entry.billed += mc.kwhBilled;
        entry.recorded += mc.kwhRecorded;
        byMonth.set(key, entry);
      }
    }
    let frDivergencePct: number | null = null;
    let frDivergenceMonth: string | null = null;
    const months = Array.from(byMonth.keys()).sort();
    for (let i = months.length - 1; i >= 0; i--) {
      const entry = byMonth.get(months[i]);
      if (!entry || entry.billed <= 0) continue;
      frDivergenceMonth = months[i];
      frDivergencePct =
        Math.round(((entry.billed - entry.recorded) / entry.billed) * 1000) / 10;
      break;
    }

    return {
      stationId: station.id,
      station,
      sources: {
        enel: accounts.filter((a) => a.accountType === ACCOUNT_TYPE.energyEnel).length,
        edp: accounts.filter((a) => a.accountType === ACCOUNT_TYPE.energyEdp).length,
        rent: accounts.filter((a) => a.accountType === ACCOUNT_TYPE.rent).length,
        thirdParty: accounts.filter((a) => a.accountType === ACCOUNT_TYPE.thirdParty).length,
      },
      worstBillStatus,
      earliestOpenDueDate,
      lastBillingTotal,
      autoDebitAggregate,
      rentStatusCurrentMonth,
      freshness,
      hasCarriedForwardStatus: states.some((s) => s.isStatusCarriedForward),
      frDivergencePct,
      frDivergenceMonth,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Alerts — the 7 n8n watchdog rules + the 2 irregularity outer joins
// ═══════════════════════════════════════════════════════════════════════════

function makeAlert(
  alertType: Alert["alertType"],
  severity: Alert["severity"],
  dedupeKey: string,
  fields: Partial<Pick<Alert, "stationId" | "billingAccountId" | "chargeId">>,
  payload: Record<string, unknown>,
): Alert {
  return {
    id: dedupeKey,
    alertType,
    severity,
    stationId: fields.stationId ?? null,
    billingAccountId: fields.billingAccountId ?? null,
    chargeId: fields.chargeId ?? null,
    dedupeKey,
    payload,
    status: ALERT_STATUS.open,
  };
}

/**
 * Evaluates every alert rule against the snapshot at instant `now`.
 * Dedupe keys are deterministic ('overdue:{accountId}:{dueDate}', ...) so
 * repeated evaluations upsert instead of duplicating (Phase 2 behavior).
 */
export function evaluateAlerts(snapshot: DomainSnapshot, now: Date): Alert[] {
  const alerts = new Map<string, Alert>();
  const push = (a: Alert) => {
    if (!alerts.has(a.dedupeKey)) alerts.set(a.dedupeKey, a);
  };

  const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));
  const currentMonth = monthOf(now);
  const previousMonth = monthOf(now, -1);

  for (const state of snapshot.utilityAccountStates) {
    const account = accountById.get(state.billingAccountId);
    const stationId = account?.stationId ?? null;
    const isEdp = account?.accountType === ACCOUNT_TYPE.energyEdp;
    const base = { stationId, billingAccountId: state.billingAccountId };

    // Phase 2.5 sever: portal data froze at the final clone. Bill-level rules
    // only fire while the scrape is recent (≤30 days) so they quietly stop on
    // frozen data instead of alerting forever (plan M2).
    const scrapeFresh =
      state.scrapedAt !== null && daysSince(state.scrapedAt, now) <= 30;

    // 1. overdue_bill — current status 'Vencida', or a 'Vencida' entry in the
    // invoice history; EDP rows whose Ultimo Comprovante is dated on the due
    // date already have a registered receipt and are skipped (n8n
    // VencidasEnelWarning parity).
    const historyOverdue = state.invoiceHistoryStatuses.includes(
      UTILITY_BILL_STATUS.vencida,
    );
    const receipted =
      isEdp &&
      state.ultimoComprovanteDate !== null &&
      state.dueDate !== null &&
      state.ultimoComprovanteDate >= state.dueDate;
    if (
      scrapeFresh &&
      (state.billStatus === UTILITY_BILL_STATUS.vencida || historyOverdue) &&
      !receipted
    ) {
      push(
        makeAlert(
          ALERT_TYPE.overdueBill,
          ALERT_SEVERITY.critical,
          `overdue:${state.billingAccountId}:${state.dueDate ?? "na"}`,
          base,
          {
            dueDate: state.dueDate,
            lastBilling: state.lastBilling,
            billStatus: state.billStatus,
            fromHistory: state.billStatus !== UTILITY_BILL_STATUS.vencida,
          },
        ),
      );
    }

    // 2. due_soon_no_auto_debit — bill due in 0..7 days without auto-debit.
    if (
      scrapeFresh &&
      state.dueDate !== null &&
      state.autoDebit !== AUTO_DEBIT_STATUS.cadastrado &&
      state.billStatus !== null &&
      OPEN_BILL_STATUSES.has(state.billStatus)
    ) {
      const days = daysUntil(state.dueDate, now);
      if (days >= 0 && days <= 7) {
        push(
          makeAlert(
            ALERT_TYPE.dueSoonNoAutoDebit,
            ALERT_SEVERITY.warning,
            `due_soon:${state.billingAccountId}:${state.dueDate}`,
            base,
            { dueDate: state.dueDate, daysUntilDue: days, lastBilling: state.lastBilling },
          ),
        );
      }
    }

    // 3. no_auto_debit — freshly scraped (≤7 days) and not registered.
    if (
      state.autoDebit === AUTO_DEBIT_STATUS.naoCadastrado &&
      state.scrapedAt !== null &&
      daysSince(state.scrapedAt, now) <= 7
    ) {
      push(
        makeAlert(
          ALERT_TYPE.noAutoDebit,
          ALERT_SEVERITY.warning,
          `no_auto_debit:${state.billingAccountId}`,
          base,
          { scrapedAt: state.scrapedAt },
        ),
      );
    }

    // 4. scraper_stale — RETIRED (Phase 2.5 sever): the scraper no longer
    // feeds this app, so "no scrape for 3..30 days" is the expected steady
    // state, not an anomaly. The alert type stays in the enum + auto-resolve
    // set so old rows clear.

    // 5. new_installation — first seen by the scraper < 3 days ago.
    if (state.firstSeenAt !== null && daysSince(state.firstSeenAt, now) < 3) {
      push(
        makeAlert(
          ALERT_TYPE.newInstallation,
          ALERT_SEVERITY.info,
          `new_installation:${state.billingAccountId}`,
          base,
          { firstSeenAt: state.firstSeenAt },
        ),
      );
    }

    // 6. negotiated_invoice — a negotiated month equal to the current or
    // previous month needs a manual payment (auto-debit won't cover it).
    for (const competencia of state.negotiatedCompetencias) {
      if (competencia === currentMonth || competencia === previousMonth) {
        push(
          makeAlert(
            ALERT_TYPE.negotiatedInvoice,
            ALERT_SEVERITY.warning,
            `negotiated:${state.billingAccountId}:${competencia}`,
            base,
            { competencia, negotiatedInvoices: state.negotiatedInvoices },
          ),
        );
      }
    }

    // 7. scheduled_shutdown — programmed ENEL outage in the next 7 days.
    if (state.shutdownDate !== null) {
      const days = daysUntil(state.shutdownDate, now);
      if (days >= 0 && days <= 7) {
        push(
          makeAlert(
            ALERT_TYPE.scheduledShutdown,
            ALERT_SEVERITY.warning,
            `shutdown:${state.billingAccountId}:${state.shutdownDate}`,
            base,
            {
              shutdownDate: state.shutdownDate,
              shutdownStart: state.shutdownStart,
              shutdownEnd: state.shutdownEnd,
            },
          ),
        );
      }
    }
  }

  // Irregularities: two outer joins (SStation_without_contract parity).
  const stationsWithContract = new Set(
    snapshot.contracts
      .filter((c) => c.stationId !== null)
      .map((c) => c.stationId as number),
  );
  const stationIds = new Set(snapshot.stations.map((s) => s.id));

  for (const station of snapshot.stations) {
    if (station.status !== STATION_STATUS.ACTIVE) continue;
    if (stationsWithContract.has(station.id)) continue;
    push(
      makeAlert(
        ALERT_TYPE.stationWithoutContract,
        ALERT_SEVERITY.warning,
        `station_without_contract:${station.id}`,
        { stationId: station.id },
        { stationName: station.name, stationStatus: station.status },
      ),
    );
  }

  for (const contract of snapshot.contracts) {
    if (contract.status !== STATION_STATUS.ACTIVE) continue;
    const missing =
      contract.stationId === null || !stationIds.has(contract.stationId);
    if (!missing) continue;
    push(
      makeAlert(
        ALERT_TYPE.contractWithoutStation,
        ALERT_SEVERITY.warning,
        `contract_without_station:${contract.id}`,
        { stationId: contract.stationId },
        {
          contractId: contract.id,
          cadastroId: contract.cadastroId,
          address: contract.address,
        },
      ),
    );
  }

  // manual_rent_reminder (Phase 2.5 R4): ACTIVE rent_manual contracts (Ipiranga
  // / Smart Kitchens) whose current-month rent charge hasn't been created yet —
  // gerar_mes deliberately skips them, so a human must collect the rent. The
  // dedupe_key carries the competência and the reminder auto-resolves once a
  // rent charge for that month exists.
  const rentChargeMonths = new Set<string>();
  for (const c of snapshot.charges) {
    if (
      (c.kind === "aluguel" || c.kind === "aluguel_energia") &&
      c.competencia !== null
    ) {
      const key = c.billingAccountId ?? `station:${c.stationId ?? "na"}`;
      rentChargeMonths.add(`${key}:${c.competencia.slice(0, 7)}`);
    }
  }
  const rentAccountByContract = new Map<string, string>();
  for (const a of snapshot.billingAccounts) {
    if (a.accountType === "rent" && a.contractId !== null) {
      rentAccountByContract.set(a.contractId, a.id);
    }
  }
  for (const contract of snapshot.contracts) {
    if (contract.status !== STATION_STATUS.ACTIVE) continue;
    if (contract.rentManual !== true) continue;
    const rentAccountId = rentAccountByContract.get(contract.id);
    const key = rentAccountId ?? `station:${contract.stationId ?? "na"}`;
    const hasCharge = rentChargeMonths.has(`${key}:${currentMonth}`);
    if (hasCharge) continue;
    push(
      makeAlert(
        ALERT_TYPE.manualRentReminder,
        ALERT_SEVERITY.warning,
        `manual_rent_reminder:${contract.id}:${currentMonth}`,
        { stationId: contract.stationId, billingAccountId: rentAccountId ?? null },
        {
          contractId: contract.id,
          cadastroId: contract.cadastroId,
          address: contract.address,
          competencia: currentMonth,
        },
      ),
    );
  }

  return Array.from(alerts.values());
}
