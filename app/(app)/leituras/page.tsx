import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Camera } from "lucide-react";

import { getRepository } from "@/lib/data/repository.server";
import { STATION_STATUS } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { StatCard } from "@/components/vammo/stat-card";
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

      <Card size="sm">
        <CardHeader>
          <CardTitle>O registro de leituras chega na fase 2</CardTitle>
          <CardDescription>
            Nesta fase o app é somente leitura: você já pode testar o fluxo de
            captura em &ldquo;Nova leitura&rdquo; (foto obrigatória + leitura em
            kWh), mas nada é salvo. Nenhuma estação marcada para leitura manual
            ainda — a marcação chega na fase 2, junto com o banco de dados. A
            tabela abaixo lista todas as estações ativas como candidatas.
          </CardDescription>
        </CardHeader>
      </Card>

      <Suspense fallback={<LeiturasSkeleton />}>
        <LeiturasContent />
      </Suspense>
    </div>
  );
}

async function LeiturasContent() {
  const repo = getRepository();
  const rollups = await repo.getStations();

  // Phase 1 has no per-station leitura_manual flag (arrives with Supabase),
  // so every ACTIVE station is a candidate — see the explainer card above.
  const rows: LeituraStationRow[] = rollups
    .filter((r) => r.station.status === STATION_STATUS.ACTIVE)
    .map((r) => ({
      id: r.stationId,
      name: r.station.name,
      address: r.station.address,
      freshness: r.freshness,
    }));

  return (
    <div className="space-y-4">
      <div className="grid max-w-xl grid-cols-2 gap-3">
        <StatCard
          label="Lidas este mês"
          value={0}
          sub="nenhuma leitura registrada — registro na fase 2"
        />
        <StatCard
          label="Pendentes"
          value={0}
          sub="nenhuma estação marcada para leitura manual"
        />
      </div>

      <div>
        <h2 className="pb-2 text-sm font-semibold text-foreground">
          Estações candidatas{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            ({rows.length} ativas)
          </span>
        </h2>
        <LeiturasTable rows={rows} />
      </div>
    </div>
  );
}

function LeiturasSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid max-w-xl grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <DataTableSkeleton />
    </div>
  );
}
