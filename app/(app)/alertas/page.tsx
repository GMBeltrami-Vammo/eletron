import { Suspense } from "react";
import type { Metadata } from "next";

import { AlertsPanel } from "@/components/alertas/alerts-panel";
import {
  SEVERITY_RANK,
  type AlertRow,
} from "@/components/alertas/alert-ui";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getRepository } from "@/lib/data/repository.server";

export const metadata: Metadata = { title: "Alertas" };

export default function AlertasPage() {
  return (
    <Suspense fallback={<AlertsSkeleton />}>
      <AlertsContent />
    </Suspense>
  );
}

async function AlertsContent() {
  const repo = getRepository();
  const [alerts, freshness, snapshot] = await Promise.all([
    repo.getAlerts(),
    repo.getFreshness(),
    repo.getSnapshot(),
  ]);

  const stationNameById = new Map(
    snapshot.stations.map((station) => [station.id, station.name]),
  );

  const rows: AlertRow[] = alerts
    .map((alert) => ({
      id: alert.id,
      alertType: alert.alertType,
      severity: alert.severity,
      stationId: alert.stationId,
      stationName:
        alert.stationId !== null
          ? (stationNameById.get(alert.stationId) ?? null)
          : null,
      billingAccountId: alert.billingAccountId,
      payload: alert.payload,
    }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.alertType.localeCompare(b.alertType) ||
        (a.stationId ?? Number.MAX_SAFE_INTEGER) -
          (b.stationId ?? Number.MAX_SAFE_INTEGER),
    );

  return <AlertsPanel rows={rows} lastScrapedAt={freshness.maxScrapedAt} />;
}

function AlertsSkeleton() {
  return (
    <div>
      <PageHeader title="Alertas" description="Calculado sobre a última coleta" />
      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <DataTableSkeleton />
    </div>
  );
}
