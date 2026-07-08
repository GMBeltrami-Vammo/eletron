import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getRepository } from "@/lib/data/repository.server";
import { STATION_STATUS } from "@/lib/domain";
import {
  getSessionEmail,
  isOperatorEmail,
  userClientFor,
} from "@/lib/http/guards";
import { readEnergyAccounts } from "@/components/energia/energy-accounts";
import { readMeterReadings } from "@/components/leituras/readings-read";
import { ACCOUNT_TYPE_UI } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/vammo/page-header";
import {
  NovaLeituraFlow,
  type LastReading,
  type MeterAccountOption,
  type StationOption,
} from "@/components/leituras/nova-leitura-flow";

export const metadata: Metadata = { title: "Nova leitura" };

/** Best-effort operator check for the client write gate (fails closed). */
async function currentIsOperator(): Promise<boolean> {
  try {
    const email = await getSessionEmail();
    if (!email) return false;
    const client = await userClientFor(email);
    return await isOperatorEmail(client, email);
  } catch {
    return false;
  }
}

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
  const [snapshot, accounts, readingsResult, email, canWrite] =
    await Promise.all([
      repo.getSnapshot(),
      readEnergyAccounts(),
      readMeterReadings(),
      getSessionEmail(),
      currentIsOperator(),
    ]);

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

  // Group metered energy accounts per station (picker only renders when >1).
  const meteredAccountsByStation: Record<number, MeterAccountOption[]> = {};
  for (const a of accounts) {
    if (a.stationId === null) continue;
    const label = `${ACCOUNT_TYPE_UI[a.provider].label} · ${a.installationKey}`;
    (meteredAccountsByStation[a.stationId] ??= []).push({ id: a.id, label });
  }

  // Latest reading per station (readings arrive newest-first).
  const lastReadingByStation: Record<number, LastReading> = {};
  for (const r of readingsResult.readings) {
    if (!(r.stationId in lastReadingByStation)) {
      lastReadingByStation[r.stationId] = { kwh: r.readingKwh, date: r.readingDate };
    }
  }

  return (
    <NovaLeituraFlow
      stations={stations}
      initialStationId={initialStationId}
      meteredAccountsByStation={meteredAccountsByStation}
      lastReadingByStation={lastReadingByStation}
      canWrite={canWrite}
      userEmail={email}
    />
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
