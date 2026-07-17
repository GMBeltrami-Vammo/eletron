import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/vammo/page-header";
import { NovoContratoFlow } from "@/components/contratos/novo-contrato-flow";
import { getRepository } from "@/lib/data/repository.server";
import { getViewer } from "@/components/admin/viewer";
import type { StationOption } from "@/app/(app)/revisao/contratos/queries";

export const metadata = { title: "Novo contrato" };

export default async function NovoContratoPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; station?: string }>;
}) {
  const sp = await searchParams;
  const initialMode = sp.mode === "manual" ? "manual" : "extract";
  const stationParam = sp.station ? Number.parseInt(sp.station, 10) : NaN;
  const initialStationId = Number.isInteger(stationParam) ? stationParam : null;

  const viewer = await getViewer();
  // Station picker options come from the cached snapshot (canonical station
  // list, decision #28 — the app attaches to existing stations, never creates).
  let stations: StationOption[] = [];
  try {
    const snapshot = await getRepository().getSnapshot();
    stations = snapshot.stations
      .map((s) => ({ id: s.id, name: s.name, activeBoxes: s.activeBoxes ?? null }))
      .sort((a, b) => a.id - b.id);
  } catch {
    stations = [];
  }

  return (
    <div>
      <PageHeader
        title="Novo contrato"
        description="Envie o PDF, revise a extração e confirme — o contrato é criado ao final"
        actions={
          <Button variant="outline" render={<Link href="/alugueis" />}>
            <ArrowLeft className="size-4" strokeWidth={2} />
            Voltar
          </Button>
        }
      />
      <NovoContratoFlow
        stations={stations}
        canWrite={viewer.role !== null}
        initialMode={initialMode}
        initialStationId={initialStationId}
      />
    </div>
  );
}
