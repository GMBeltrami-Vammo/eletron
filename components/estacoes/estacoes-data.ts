/**
 * Server-side assembly for /estacoes: joins StationRollups with contracts,
 * counterparties, alert types and shutdown payloads into plain EstacaoRow
 * objects, and computes the KPI-strip aggregates.
 *
 * Server-only (imports repository.server) — import from server components
 * only, never from a 'use client' module.
 */

import {
  ACCOUNT_TYPE,
  ALERT_TYPE,
  AUTO_DEBIT_STATUS,
  CHARGE_KIND,
  CHARGE_STATUS,
  STATION_STATUS,
  UTILITY_BILL_STATUS,
  type ChargeStatus,
  type Contract,
} from "@/lib/domain";
import type { FreshnessInfo } from "@/lib/data/repository";
import { getRepository } from "@/lib/data/repository.server";
import { monthOf } from "@/lib/ingest/derive";
import { UTILITY_BILL_STATUS_UI } from "@/lib/labels";

import type { EstacaoRow, EstacoesKpis } from "./types";

/**
 * Rent-ledger statuses that still need money to move (mirrors
 * OPEN_CHARGE_STATUSES in lib/ingest/derive.ts, which is not exported).
 */
const OPEN_RENT_STATUSES: ReadonlySet<ChargeStatus> = new Set([
  CHARGE_STATUS.pendente,
  CHARGE_STATUS.boletoRecebido,
  CHARGE_STATUS.atrasado,
  CHARGE_STATUS.emCompensacao,
  CHARGE_STATUS.negociada,
]);

export interface EstacoesPageData {
  rows: EstacaoRow[];
  kpis: EstacoesKpis;
  freshness: FreshnessInfo;
}

export async function loadEstacoesPageData(): Promise<EstacoesPageData> {
  const repo = getRepository();
  const [snapshot, rollups, alerts, irregularities, freshness] =
    await Promise.all([
      repo.getSnapshot(),
      repo.getStations(),
      repo.getAlerts(),
      repo.getIrregularities(),
      repo.getFreshness(),
    ]);

  const currentMonth = monthOf(new Date());
  const rentCharges = (await repo.getCharges({ competencia: currentMonth }))
    .filter(
      (c) =>
        (c.kind === CHARGE_KIND.aluguel ||
          c.kind === CHARGE_KIND.aluguelEnergia) &&
        OPEN_RENT_STATUSES.has(c.status),
    );

  // ── Lookup maps ──────────────────────────────────────────────────────────
  const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));
  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((s) => [s.billingAccountId, s]),
  );
  const counterpartyById = new Map(
    snapshot.counterparties.map((c) => [c.id, c]),
  );

  const contractsByStation = new Map<number, Contract[]>();
  for (const contract of snapshot.contracts) {
    if (contract.stationId === null) continue;
    const list = contractsByStation.get(contract.stationId) ?? [];
    list.push(contract);
    contractsByStation.set(contract.stationId, list);
  }

  const alertTypesByStation = new Map<number, Set<string>>();
  const shutdownByStation = new Map<
    number,
    { date: string; window: string | null }
  >();
  for (const alert of alerts) {
    if (alert.stationId === null) continue;
    const set = alertTypesByStation.get(alert.stationId) ?? new Set<string>();
    set.add(alert.alertType);
    alertTypesByStation.set(alert.stationId, set);

    if (alert.alertType === ALERT_TYPE.scheduledShutdown) {
      const date =
        typeof alert.payload.shutdownDate === "string"
          ? alert.payload.shutdownDate
          : null;
      if (date !== null) {
        const start =
          typeof alert.payload.shutdownStart === "string"
            ? alert.payload.shutdownStart
            : null;
        const end =
          typeof alert.payload.shutdownEnd === "string"
            ? alert.payload.shutdownEnd
            : null;
        const window = start && end ? `${start}–${end}` : (start ?? end);
        const existing = shutdownByStation.get(alert.stationId);
        if (!existing || date < existing.date) {
          shutdownByStation.set(alert.stationId, { date, window });
        }
      }
    }
  }

  // ── Rows ─────────────────────────────────────────────────────────────────
  const rows: EstacaoRow[] = rollups.map((rollup) => {
    const stationContracts = contractsByStation.get(rollup.stationId) ?? [];
    const contract =
      stationContracts.find((c) => c.status === STATION_STATUS.ACTIVE) ??
      stationContracts[0] ??
      null;
    const counterparty = contract?.counterpartyId
      ? (counterpartyById.get(contract.counterpartyId) ?? null)
      : null;

    const billStatusDetail: string[] = [];
    for (const account of snapshot.billingAccounts) {
      if (account.stationId !== rollup.stationId) continue;
      if (
        account.accountType !== ACCOUNT_TYPE.energyEnel &&
        account.accountType !== ACCOUNT_TYPE.energyEdp
      ) {
        continue;
      }
      const state = stateByAccount.get(account.id);
      if (!state) continue;
      const who =
        account.accountType === ACCOUNT_TYPE.energyEnel
          ? `Enel ${account.enelId ?? "?"}`
          : `EDP ${account.edpUc ?? "?"}`;
      const statusLabel = state.billStatus
        ? UTILITY_BILL_STATUS_UI[state.billStatus].label
        : "—";
      const caveat = state.isStatusCarriedForward
        ? " (status pode estar defasado — carregado da última coleta)"
        : "";
      billStatusDetail.push(`${who}: ${statusLabel}${caveat}`);
    }

    const shutdown = shutdownByStation.get(rollup.stationId) ?? null;

    return {
      stationId: rollup.stationId,
      name: rollup.station.name,
      address: rollup.station.address,
      status: rollup.station.status,
      sources: rollup.sources,
      worstBillStatus: rollup.worstBillStatus,
      billStatusDetail,
      hasCarriedForwardStatus: rollup.hasCarriedForwardStatus,
      earliestOpenDueDate: rollup.earliestOpenDueDate,
      lastBillingTotal: rollup.lastBillingTotal,
      autoDebitAggregate: rollup.autoDebitAggregate,
      rentStatusCurrentMonth: rollup.rentStatusCurrentMonth,
      contractType: contract?.contractType ?? null,
      valorMensal: contract?.valorMensal ?? null,
      boxCount: contract?.boxCount ?? null,
      cadastroId: contract?.cadastroId ?? null,
      parceiro: counterparty?.name ?? null,
      freshness: rollup.freshness,
      shutdownDate: shutdown?.date ?? null,
      shutdownWindow: shutdown?.window ?? null,
      alertTypes: Array.from(
        alertTypesByStation.get(rollup.stationId) ?? [],
      ).sort(),
      latitude: rollup.station.latitude,
      longitude: rollup.station.longitude,
      sourceCreatedAt: rollup.station.sourceCreatedAt,
      frDivergencePct: rollup.frDivergencePct,
      frDivergenceMonth: rollup.frDivergenceMonth,
    };
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const overdueStates = snapshot.utilityAccountStates.filter(
    (s) => s.billStatus === UTILITY_BILL_STATUS.vencida,
  );
  const vencidasTotal =
    Math.round(
      overdueStates.reduce((sum, s) => sum + (s.lastBilling ?? 0), 0) * 100,
    ) / 100;

  // Only installations attached to accounts count for the DA KPIs.
  const semDaCount = snapshot.utilityAccountStates.filter(
    (s) =>
      s.autoDebit === AUTO_DEBIT_STATUS.naoCadastrado &&
      accountById.has(s.billingAccountId),
  ).length;

  const kpis: EstacoesKpis = {
    ativas: rows.filter((r) => r.status === STATION_STATUS.ACTIVE).length,
    totalEstacoes: rows.length,
    vencidasCount: overdueStates.length,
    vencidasTotal,
    venceSemDaCount: alerts.filter(
      (a) => a.alertType === ALERT_TYPE.dueSoonNoAutoDebit,
    ).length,
    semDaCount,
    rentPendingCount: rentCharges.length,
    rentPendingTotal:
      Math.round(
        rentCharges.reduce((sum, c) => sum + (c.amount ?? 0), 0) * 100,
      ) / 100,
    enelMaxScrapedAt: freshness.byProvider.enel.maxScrapedAt,
    edpMaxScrapedAt: freshness.byProvider.edp.maxScrapedAt,
    emRevisaoCount:
      irregularities.joinAlerts.length +
      irregularities.unmatchedAccounts.length +
      irregularities.unmatchedCharges.length,
  };

  return { rows, kpis, freshness };
}
