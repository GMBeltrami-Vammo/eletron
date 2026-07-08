import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Camera, Info } from "lucide-react";

import { getRepository } from "@/lib/data/repository.server";
import { STATION_STATUS } from "@/lib/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { ReadingsView } from "@/components/leituras/readings-view";
import { readMeterReadings } from "@/components/leituras/readings-read";
import {
  LeiturasTable,
  type LeituraStationRow,
} from "@/components/leituras/leituras-table";

export const metadata: Metadata = { title: "Leituras" };

export default function LeiturasPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Leituras"
        description="Leituras manuais de medidor — estações com medição física mensal"
        actions={
          <Button render={<Link href="/leituras/nova" />}>
            <Camera className="size-4" strokeWidth={2} />
            Nova leitura
          </Button>
        }
      />

      <Suspense fallback={<LeiturasSkeleton />}>
        <LeiturasContent />
      </Suspense>
    </div>
  );
}

async function LeiturasContent() {
  const repo = getRepository();
  const [rollups, readingsResult] = await Promise.all([
    repo.getStations(),
    readMeterReadings(),
  ]);

  const stationsById: Record<number, { name: string | null; address: string | null }> =
    {};
  for (const r of rollups) {
    stationsById[r.stationId] = {
      name: r.station.name,
      address: r.station.address,
    };
  }

  const stationsWithReadings = new Set(
    readingsResult.readings.map((r) => r.stationId),
  );

  // Candidatas = ACTIVE stations that have never been read (deep-link to nova).
  const candidatas: LeituraStationRow[] = rollups
    .filter(
      (r) =>
        r.station.status === STATION_STATUS.ACTIVE &&
        !stationsWithReadings.has(r.stationId),
    )
    .map((r) => ({
      id: r.stationId,
      name: r.station.name,
      address: r.station.address,
      freshness: r.freshness,
    }));

  return (
    <div className="space-y-6">
      {readingsResult.available ? (
        <ReadingsView
          readings={readingsResult.readings}
          stationsById={stationsById}
        />
      ) : (
        <Alert>
          <Info strokeWidth={2} />
          <AlertTitle>Leituras registradas aparecem com o banco</AlertTitle>
          <AlertDescription>
            O registro de leituras (fase 2) grava no banco charging. Sem ele
            conectado, só as estações candidatas abaixo são listadas. Você já
            pode capturar em &ldquo;Nova leitura&rdquo;.
          </AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className="pb-2 text-sm font-semibold text-foreground">
          Estações candidatas{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            ({candidatas.length} ativas sem leitura)
          </span>
        </h2>
        <LeiturasTable rows={candidatas} />
      </div>
    </div>
  );
}

function LeiturasSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="hidden h-24 rounded-xl sm:block" />
      </div>
      <DataTableSkeleton />
    </div>
  );
}
