import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import {
  ContractsWithoutStationTable,
  StationsWithoutContractTable,
  type ContractWithoutStationRow,
  type StationWithoutContractRow,
} from "@/components/revisao/irregularities-tables";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { getRepository } from "@/lib/data/repository.server";

export const metadata: Metadata = { title: "Irregularidades" };

const DESCRIPTION =
  "Cruzamento entre estações ativas no Metabase e cadastros de locação";

export default function IrregularidadesPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <IrregularidadesContent />
      </Suspense>
    </div>
  );
}

function pickString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pickNumber(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function IrregularidadesContent() {
  const repo = getRepository();
  const [irregularities, snapshot, freshness] = await Promise.all([
    repo.getIrregularities(),
    repo.getSnapshot(),
    repo.getFreshness(),
  ]);

  const stationById = new Map(
    snapshot.stations.map((station) => [station.id, station]),
  );
  const contractById = new Map(
    snapshot.contracts.map((contract) => [contract.id, contract]),
  );
  // Faturas de energia sem vencimento agora fazem parte da fila "Faturas a
  // arrumar" (/revisao/faturas-a-arrumar, Gabriel 2026-07-21), que também
  // cobre sem competência / valor / NF e as tira das tabelas reais.

  const stationsWithoutContract: StationWithoutContractRow[] =
    irregularities.joinAlerts
      .filter((alert) => alert.alertType === "station_without_contract")
      .map((alert) => {
        const station =
          alert.stationId !== null
            ? stationById.get(alert.stationId)
            : undefined;
        return {
          stationId: alert.stationId,
          stationName:
            pickString(alert.payload, "stationName") ?? station?.name ?? null,
          address: station?.address ?? null,
          status: station?.status ?? null,
          sourceCreatedAt: station?.sourceCreatedAt ?? null,
        };
      });

  const contractsWithoutStation: ContractWithoutStationRow[] =
    irregularities.joinAlerts
      .filter((alert) => alert.alertType === "contract_without_station")
      .map((alert) => {
        const contractId = pickString(alert.payload, "contractId");
        const contract = contractId ? contractById.get(contractId) : undefined;
        return {
          contractId: contractId ?? alert.id,
          cadastroId:
            contract?.cadastroId ??
            pickNumber(alert.payload, "cadastroId") ??
            null,
          address:
            contract?.address ?? pickString(alert.payload, "address") ?? null,
          stationId: contract?.stationId ?? alert.stationId,
          contractType: contract?.contractType ?? null,
          valorMensal: contract?.valorMensal ?? null,
          contactName: contract?.contactName ?? null,
        };
      });

  return (
    <div>
      <PageHeader
        title="Irregularidades"
        description={DESCRIPTION}
        actions={
          <FreshnessDot
            timestamp={freshness.maxScrapedAt}
            label="Última coleta"
          />
        }
      />
      <div className="space-y-8">
        <section>
          <h2 className="pb-3 text-base font-semibold">
            Estações sem contrato{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              ({stationsWithoutContract.length})
            </span>
          </h2>
          <StationsWithoutContractTable rows={stationsWithoutContract} />
        </section>
        <section>
          <h2 className="pb-3 text-base font-semibold">
            Contratos sem estação{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              ({contractsWithoutStation.length})
            </span>
          </h2>
          <ContractsWithoutStationTable rows={contractsWithoutStation} />
        </section>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Irregularidades" description={DESCRIPTION} />
      <div className="space-y-8">
        <DataTableSkeleton rows={4} />
        <DataTableSkeleton rows={4} />
      </div>
    </div>
  );
}
