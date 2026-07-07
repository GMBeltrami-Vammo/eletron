import { Suspense } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import {
  contractEndInfo,
  contractFormulaSummary,
  maskTail,
} from "@/components/alugueis/contract-utils";
import {
  ContractsTable,
  type ContractRow,
} from "@/components/alugueis/contracts-table";
import { getRepository } from "@/lib/data/repository.server";

export const metadata = { title: "Aluguéis" };

export default function AlugueisPage() {
  return (
    <div>
      <PageHeader
        title="Aluguéis"
        description="Contratos de locação das estações de troca"
        actions={
          <span title="Disponível na fase 3">
            <Button disabled>
              <Plus className="size-4" strokeWidth={2} />
              Novo contrato
            </Button>
          </span>
        }
      />
      <Suspense fallback={<DataTableSkeleton />}>
        <ContractsSection />
      </Suspense>
    </div>
  );
}

async function ContractsSection() {
  const repo = getRepository();
  const [snapshot, contracts] = await Promise.all([
    repo.getSnapshot(),
    repo.getContracts(),
  ]);
  const now = new Date();
  const stationById = new Map(snapshot.stations.map((s) => [s.id, s]));
  const counterpartyById = new Map(
    snapshot.counterparties.map((c) => [c.id, c]),
  );

  const rows: ContractRow[] = contracts.map((contract) => {
    const station =
      contract.stationId !== null
        ? stationById.get(contract.stationId)
        : undefined;
    const counterparty = contract.counterpartyId
      ? (counterpartyById.get(contract.counterpartyId) ?? null)
      : null;
    return {
      cadastroId: contract.cadastroId,
      stationId: contract.stationId,
      stationExists: station !== undefined,
      stationName: station?.name ?? null,
      parceiro: counterparty?.name ?? null,
      contractType: contract.contractType,
      formula: contractFormulaSummary(contract),
      valorMensal: contract.valorMensal,
      dueDay: contract.dueDay,
      paymentMethod: contract.paymentMethod,
      status: contract.status,
      startsOn: contract.startsOn,
      endsOn: contract.endsOn,
      endInfo: contractEndInfo(contract.endsOn, now),
      contactName: contract.contactName,
      phone: contract.phone,
      email: contract.email,
      cnpjCpfMasked: counterparty?.cnpjCpf
        ? maskTail(counterparty.cnpjCpf)
        : null,
    };
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums">{rows.length}</span>{" "}
          {rows.length === 1 ? "contrato" : "contratos"}
        </span>
        <FreshnessDot
          label="Planilha de aluguéis"
          timestamp={snapshot.fetchedAt}
          warnHours={1}
          criticalHours={3}
        />
      </div>
      <ContractsTable rows={rows} />
    </div>
  );
}
