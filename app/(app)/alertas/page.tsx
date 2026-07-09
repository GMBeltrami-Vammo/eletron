import { Suspense } from "react";
import type { Metadata } from "next";
import { Info } from "lucide-react";

import { AlertsPanel } from "@/components/alertas/alerts-panel";
import { AlertsLifecyclePanel } from "@/components/alertas/alerts-lifecycle-panel";
import { SEVERITY_RANK, type AlertRow } from "@/components/alertas/alert-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/components/admin/viewer";
import { getRepository } from "@/lib/data/repository.server";
import { IRREGULARITY_ALERT_TYPES } from "@/lib/ingest/derive";

import { readPersistedAlerts } from "./persisted-alerts";

export const metadata: Metadata = { title: "Alertas" };

export default function AlertasPage() {
  return (
    <Suspense fallback={<AlertsSkeleton />}>
      <AlertsContent />
    </Suspense>
  );
}

async function AlertsContent() {
  const [viewer, persisted] = await Promise.all([
    getViewer(),
    readPersistedAlerts(),
  ]);

  // Post-cutover: persisted alerts carry the acknowledge/resolve/mute lifecycle.
  // Join irregularities (station↔contract) live in /revisão, not here.
  if (persisted.configured && persisted.rows.length > 0) {
    return (
      <AlertsLifecyclePanel
        rows={persisted.rows.filter(
          (r) => !IRREGULARITY_ALERT_TYPES.has(r.alertType),
        )}
        lastScrapedAt={persisted.lastScrapedAt}
        canWrite={viewer.role !== null}
      />
    );
  }

  // Fallback: the Phase-1 computed view (no Supabase, or alerts not persisted
  // yet). Computed alerts have no uuid, so lifecycle actions can't apply here.
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
    .filter((alert) => !IRREGULARITY_ALERT_TYPES.has(alert.alertType))
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

  return (
    <>
      {persisted.configured ? (
        <Alert className="mb-4">
          <Info strokeWidth={2} />
          <AlertTitle>Exibindo o cálculo ao vivo da última coleta</AlertTitle>
          <AlertDescription>
            As ações de ciclo de vida (reconhecer, resolver, silenciar) ficam
            disponíveis assim que o job de alertas persistir os registros no
            banco.
          </AlertDescription>
        </Alert>
      ) : null}
      <AlertsPanel rows={rows} lastScrapedAt={freshness.maxScrapedAt} />
    </>
  );
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
