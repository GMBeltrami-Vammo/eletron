import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { getRepository } from "@/lib/data/repository.server";
import { STATION_STATUS } from "@/lib/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/vammo/page-header";
import {
  NovaLeituraFlow,
  type StationOption,
} from "@/components/leituras/nova-leitura-flow";

export const metadata: Metadata = { title: "Nova leitura" };

export default async function NovaLeituraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const stationParam = Array.isArray(params.station)
    ? params.station[0]
    : params.station;
  const initialStationId =
    stationParam !== undefined && /^\d+$/.test(stationParam)
      ? Number(stationParam)
      : null;

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/leituras" />}
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
          Leituras
        </Button>
        <PageHeader
          title="Nova leitura"
          description="Registre a leitura do medidor com foto"
          className="pt-1 pb-0"
        />
      </div>

      <Alert>
        <Info strokeWidth={2} />
        <AlertTitle>Fase 1 — teste do fluxo</AlertTitle>
        <AlertDescription>
          O registro chega na fase 2: a leitura enviada aqui não é salva.
        </AlertDescription>
      </Alert>

      <Suspense fallback={<NovaLeituraSkeleton />}>
        <NovaLeituraContent initialStationId={initialStationId} />
      </Suspense>
    </div>
  );
}

async function NovaLeituraContent({
  initialStationId,
}: {
  initialStationId: number | null;
}) {
  const repo = getRepository();
  const snapshot = await repo.getSnapshot();

  const stations: StationOption[] = snapshot.stations
    .filter((s) => s.status !== STATION_STATUS.DECOMMISSIONED)
    .map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      lat: s.latitude,
      lon: s.longitude,
    }))
    .sort((a, b) => a.id - b.id);

  return (
    <NovaLeituraFlow stations={stations} initialStationId={initialStationId} />
  );
}

function NovaLeituraSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
    </div>
  );
}
