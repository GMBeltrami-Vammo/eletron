import "server-only";

/**
 * Enel/EDP energy accounts whose station is NOT registered for débito automático
 * (auto_debit ≠ 'cadastrado') — Gabriel 2026-07-14. Read-only derivation shared
 * by the /revisão hub (the box count) and the /revisão/sem-debito-automatico
 * page (the table rows), so both never disagree. One canonical definition.
 */

import type { LoadedSnapshot } from "@/lib/data/repository";
import { ACCOUNT_TYPE } from "@/lib/domain";
import type { EnelEdpSemDaRow } from "@/components/revisao/irregularities-tables";

export function deriveEnelEdpSemDa(snapshot: LoadedSnapshot): EnelEdpSemDaRow[] {
  const stationById = new Map(
    snapshot.stations.map((station) => [station.id, station]),
  );
  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((s) => [s.billingAccountId, s]),
  );
  const chargesByAccount = new Map<string, typeof snapshot.charges>();
  for (const c of snapshot.charges) {
    if (!c.billingAccountId) continue;
    const arr = chargesByAccount.get(c.billingAccountId);
    if (arr) arr.push(c);
    else chargesByAccount.set(c.billingAccountId, [c]);
  }
  // Energy detail per charge (for the last fatura's Drive PDF link).
  const detailByCharge = new Map(
    snapshot.chargeEnergyDetails.map((d) => [d.chargeId, d]),
  );

  return snapshot.billingAccounts
    .filter(
      (a) =>
        a.accountType === ACCOUNT_TYPE.energyEnel ||
        a.accountType === ACCOUNT_TYPE.energyEdp,
    )
    .filter(
      (a) => (stateByAccount.get(a.id)?.autoDebit ?? "desconhecido") !== "cadastrado",
    )
    .map((a) => {
      const state = stateByAccount.get(a.id);
      const station = a.stationId !== null ? stationById.get(a.stationId) : undefined;
      const charges = (chargesByAccount.get(a.id) ?? [])
        .slice()
        .sort((x, y) =>
          (y.competencia ?? y.dueDate ?? "").localeCompare(
            x.competencia ?? x.dueDate ?? "",
          ),
        );
      const last = charges[0];
      return {
        vammoId: a.stationId,
        stationName: station?.name ?? null,
        installationKey: a.enelId ?? a.edpUc ?? null,
        provider: a.accountType === ACCOUNT_TYPE.energyEdp ? "EDP" : "Enel",
        address: station?.address ?? state?.address ?? null,
        autoDebitRegistration:
          a.autoDebitRegistration ?? state?.autoDebitRegistration ?? null,
        lastBillValue: last?.amount ?? null,
        lastBillDueDate: last?.dueDate ?? null,
        lastBillFaturaUrl: last ? (detailByCharge.get(last.id)?.faturaDriveUrl ?? null) : null,
        lastBillFiscalExported: last?.fiscalExported ?? false,
      } satisfies EnelEdpSemDaRow;
    });
}
