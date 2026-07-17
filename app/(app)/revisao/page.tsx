import { Suspense } from "react";
import type { Metadata } from "next";

import { QueueCard } from "@/components/revisao/queue-card";
import { deriveEnelEdpSemDa } from "@/components/revisao/sem-da-data";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getRepository } from "@/lib/data/repository.server";
import { formatCompetencia, formatDate } from "@/lib/format";
import { countPendingContractIntakes } from "./contratos/queries";

export const metadata: Metadata = { title: "Revisão" };

const DESCRIPTION = "Filas de pendências que precisam de um olhar humano";

export default function RevisaoPage() {
  return (
    <Suspense fallback={<HubSkeleton />}>
      <RevisaoContent />
    </Suspense>
  );
}

async function RevisaoContent() {
  const repo = getRepository();
  const [irregularities, snapshot, freshness, pendingContratos] = await Promise.all([
    repo.getIrregularities(),
    repo.getSnapshot(),
    repo.getFreshness(),
    countPendingContractIntakes(),
  ]);

  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((state) => [state.billingAccountId, state]),
  );

  // Oldest-item hints (cheap: min over already-loaded fields).
  const oldestFirstSeen = irregularities.unmatchedAccounts
    .map((account) => stateByAccount.get(account.id)?.firstSeenAt ?? null)
    .filter((value): value is string => value !== null)
    .sort()[0];

  const oldestChargeMonth = irregularities.unmatchedCharges
    .map((charge) => charge.competencia ?? charge.dueDate)
    .filter((value): value is string => value !== null)
    .sort()[0];

  const stationsWithoutContract = irregularities.joinAlerts.filter(
    (alert) => alert.alertType === "station_without_contract",
  ).length;
  const contractsWithoutStation =
    irregularities.joinAlerts.length - stationsWithoutContract;

  const semDaCount = deriveEnelEdpSemDa(snapshot).length;

  return (
    <div>
      <PageHeader
        title="Revisão"
        description={DESCRIPTION}
        actions={
          <FreshnessDot
            timestamp={freshness.maxScrapedAt}
            label="Última coleta"
          />
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QueueCard
          title="Contratos novos"
          description="Contratos de aluguel extraídos pela IA aguardando confirmação"
          count={pendingContratos}
          hint={pendingContratos === 0 ? "Tudo em dia" : "Aguardando revisão"}
          href="/revisao/contratos"
        />
        <QueueCard
          title="Comprovantes não conciliados"
          description="Conciliação de comprovantes chega na fase 2, com o upload no app"
          count={null}
          hint="Disponível na fase 2"
          href="/revisao/comprovantes"
        />
        <QueueCard
          title="Cobranças não identificadas"
          description="Cobranças sem contrato ou estação correspondente"
          count={irregularities.unmatchedCharges.length}
          hint={
            irregularities.unmatchedCharges.length === 0
              ? "Tudo em dia"
              : oldestChargeMonth
                ? `Mais antiga: ${formatCompetencia(oldestChargeMonth)}`
                : null
          }
          href="/revisao/cobrancas"
        />
        <QueueCard
          title="Irregularidades"
          description="Estações sem contrato e contratos sem estação"
          count={irregularities.joinAlerts.length}
          hint={
            irregularities.joinAlerts.length === 0
              ? "Tudo em dia"
              : `${stationsWithoutContract} sem contrato · ${contractsWithoutStation} sem estação`
          }
          href="/revisao/irregularidades"
        />
        <QueueCard
          title="Instalações não vinculadas"
          description="Instalações Enel/EDP sem estação — substitui o loop do Slack"
          count={irregularities.unmatchedAccounts.length}
          hint={
            irregularities.unmatchedAccounts.length === 0
              ? "Tudo em dia"
              : oldestFirstSeen
                ? `No portal desde ${formatDate(oldestFirstSeen)}`
                : null
          }
          href="/revisao/instalacoes"
        />
        <QueueCard
          title="Contas sem débito automático"
          description="Contas de energia Enel/EDP cuja estação ainda não está em débito automático"
          count={semDaCount}
          hint={semDaCount === 0 ? "Tudo em dia" : "Perseguir o cadastro em DA"}
          href="/revisao/sem-debito-automatico"
        />
      </div>
      {irregularities.issues.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {irregularities.issues.length}{" "}
          {irregularities.issues.length === 1
            ? "problema de normalização registrado"
            : "problemas de normalização registrados"}{" "}
          na última carga da planilha — nenhum dado foi descartado em silêncio.
        </p>
      ) : null}
    </div>
  );
}

function HubSkeleton() {
  return (
    <div>
      <PageHeader title="Revisão" description={DESCRIPTION} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
