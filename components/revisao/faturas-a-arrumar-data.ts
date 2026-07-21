import "server-only";

/**
 * "Faturas a arrumar" (Gabriel 2026-07-21) — energy faturas the API received
 * with a critical field missing (see lib/energia/fatura-a-arrumar). Read-only
 * derivation shared by the /revisão hub (box count) and the
 * /revisao/faturas-a-arrumar page (table rows). ONE canonical definition — the
 * same `isFaturaAArrumar` that /energia + /pagamentos use to EXCLUDE these from
 * the real tables, so the queue and the exclusion never disagree.
 */

import type { LoadedSnapshot } from "@/lib/data/repository";
import { ACCOUNT_TYPE } from "@/lib/domain";
import { SETTLED_CHARGE_STATUSES } from "@/lib/ingest/derive";
import { faturaGaps, isFaturaAArrumar } from "@/lib/energia/fatura-a-arrumar";
import type { FaturaAArrumarRow } from "@/components/revisao/faturas-a-arrumar-table";

/** refs: dedupe_key → { uuid } (from readChargeRefs) — for the adjust action. */
export function deriveFaturasAArrumar(
  snapshot: LoadedSnapshot,
  refs: Map<string, { uuid: string }>,
): FaturaAArrumarRow[] {
  const stationById = new Map(snapshot.stations.map((s) => [s.id, s]));
  const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));
  const detailByCharge = new Map(
    snapshot.chargeEnergyDetails.map((d) => [d.chargeId, d]),
  );

  const rows: FaturaAArrumarRow[] = [];
  for (const charge of snapshot.charges) {
    const account =
      charge.billingAccountId !== null ? accountById.get(charge.billingAccountId) : undefined;
    if (
      !account ||
      (account.accountType !== ACCOUNT_TYPE.energyEnel &&
        account.accountType !== ACCOUNT_TYPE.energyEdp)
    ) {
      continue;
    }
    const detail = detailByCharge.get(charge.id);
    const fields = {
      dueDate: charge.dueDate,
      competencia: charge.competencia,
      amount: charge.amount,
      nf: charge.notaFiscal ?? detail?.nf ?? null,
      settled: SETTLED_CHARGE_STATUSES.has(charge.status),
      legacyClosed: detail?.legacyClosed ?? false,
    };
    if (!isFaturaAArrumar(fields)) continue;

    const station = charge.stationId !== null ? stationById.get(charge.stationId) : undefined;
    rows.push({
      chargeId: charge.dedupeKey,
      chargeUuid: refs.get(charge.dedupeKey)?.uuid ?? null,
      provider: account.accountType === ACCOUNT_TYPE.energyEdp ? "EDP" : "Enel",
      installationKey: account.enelId ?? account.edpUc ?? null,
      stationId: charge.stationId,
      stationName: station?.name ?? null,
      competencia: charge.competencia,
      dueDate: charge.dueDate,
      amount: charge.amount,
      nf: fields.nf,
      gaps: faturaGaps(fields),
      faturaDriveUrl: detail?.faturaDriveUrl ?? null,
    });
  }
  return rows;
}
