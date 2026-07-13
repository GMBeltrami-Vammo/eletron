import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/vammo/page-header";
import { NovoContratoFlow } from "@/components/contratos/novo-contrato-flow";
import { getRepository } from "@/lib/data/repository.server";
import { getViewer } from "@/components/admin/viewer";
import type { StationOption } from "@/app/(app)/revisao/contratos/queries";

export const metadata = { title: "Novo contrato" };

export default async function NovoContratoPage() {
  const viewer = await getViewer();
  // Station picker options come from the cached snapshot (canonical station
  // list, decision #28 — the app attaches to existing stations, never creates).
  let stations: StationOption[] = [];
  try {
    const snapshot = await getRepository().getSnapshot();
    stations = snapshot.stations
      .map((s) => ({ id: s.id, name: s.name }))
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
      <NovoContratoFlow stations={stations} canWrite={viewer.role !== null} />
    </div>
  );
}
