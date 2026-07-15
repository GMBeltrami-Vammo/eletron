import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import {
  UnmatchedAccountsTable,
  type UnmatchedAccountRow,
} from "@/components/revisao/unmatched-accounts-table";
import type { StationChoice } from "@/components/revisao/match-actions";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { getRepository } from "@/lib/data/repository.server";
import { ACCOUNT_TYPE } from "@/lib/domain";
import { suggestMatches, type GeoStation } from "@/lib/matching/suggest";

export const metadata: Metadata = { title: "Instalações não vinculadas" };

const DESCRIPTION =
  "Instalações sem estação correspondente — sugestões por distância (com coordenadas) ou por endereço (feed novo) substituem o loop do Slack";

export default function InstalacoesPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <InstalacoesContent />
      </Suspense>
    </div>
  );
}

async function InstalacoesContent() {
  const repo = getRepository();
  const [irregularities, snapshot, freshness] = await Promise.all([
    repo.getIrregularities(),
    repo.getSnapshot(),
    repo.getFreshness(),
  ]);

  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((state) => [state.billingAccountId, state]),
  );

  // suggestion pool — station coords + address; exclude hidden stations so a
  // decluttered/decommissioned station is never proactively suggested (a human
  // can still pick one via the "Outra" search, which keeps the full list).
  const geoStations: GeoStation[] = snapshot.stations
    .filter((s) => !s.hidden)
    .map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      lat: s.latitude,
      lon: s.longitude,
    }));
  const stationChoices: StationChoice[] = snapshot.stations
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.id - b.id);

  // Only ENERGY installations (Enel/EDP) belong here — each maps to ONE physical
  // station via meter address/coords. A third_party biller (e.g. Hubees) serves
  // many stations and has no installation key/address, so it rendered as a broken
  // UUID row with no possible suggestion; it's reviewed per-charge in /revisão ›
  // cobranças, not station-matched here. (rent accounts already carry a station.)
  const rows: UnmatchedAccountRow[] = irregularities.unmatchedAccounts
    .filter(
      (account) =>
        account.accountType === ACCOUNT_TYPE.energyEnel ||
        account.accountType === ACCOUNT_TYPE.energyEdp,
    )
    .map((account) => {
      const state = stateByAccount.get(account.id);
      return {
        id: account.id,
        accountUuid: account.accountUuid ?? null,
        accountType: account.accountType,
        externalKey:
          account.enelId ?? account.edpUc ?? account.externalRef ?? account.id,
        matchStatus: account.matchStatus,
        address: state?.address ?? null,
        neighborhood: state?.neighborhood ?? null,
        city: state?.city ?? null,
        providerStationStatus: state?.providerStationStatus ?? null,
        billStatus: state?.billStatus ?? null,
        lastBilling: state?.lastBilling ?? null,
        dueDate: state?.dueDate ?? null,
        firstSeenAt: state?.firstSeenAt ?? null,
        scrapedAt: state?.scrapedAt ?? null,
        notes: account.notes,
        suggestions: suggestMatches(
          {
            lat: state?.lat ?? null,
            lon: state?.lon ?? null,
            address: state?.address ?? null,
          },
          geoStations,
          3,
        ),
      };
    },
  );

  return (
    <div>
      <PageHeader
        title="Instalações não vinculadas"
        description={DESCRIPTION}
        actions={
          <FreshnessDot
            timestamp={freshness.maxScrapedAt}
            label="Última coleta"
          />
        }
      />
      <UnmatchedAccountsTable rows={rows} stations={stationChoices} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Instalações não vinculadas" description={DESCRIPTION} />
      <DataTableSkeleton />
    </div>
  );
}
