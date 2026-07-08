import { Suspense } from "react";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { PagamentosView } from "@/components/pagamentos/pagamentos-view";
import type { PagamentoRow } from "@/components/pagamentos/types";
import { getRepository } from "@/lib/data/repository.server";
import {
  readPaymentLinks,
  summarizeLinks,
  type PaymentLinkIndex,
} from "@/lib/data/payment-links";
import { INGEST_SOURCE } from "@/lib/domain";
import type { LoadedSnapshot } from "@/lib/data/repository";
import { getViewer } from "@/components/admin/viewer";
import { readChargeRefs, type ChargeRef } from "./charge-refs";

export const metadata: Metadata = { title: "Pagamentos — Eletron" };

/**
 * Phase 1 ledger rows = the 2_Pagamentos backfill (source 'sheet_backfill').
 * Energy invoices from the scraper live in /energia › Faturas.
 */
function buildRows(
  snapshot: LoadedSnapshot,
  refs: Map<string, ChargeRef>,
  links: PaymentLinkIndex,
): PagamentoRow[] {
  const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));
  const contractById = new Map(snapshot.contracts.map((c) => [c.id, c]));
  const counterpartyById = new Map(
    snapshot.counterparties.map((c) => [c.id, c]),
  );
  const stationById = new Map(snapshot.stations.map((s) => [s.id, s]));

  return snapshot.charges
    .filter(
      (charge) =>
        charge.source === INGEST_SOURCE.sheetBackfill ||
        charge.source === INGEST_SOURCE.gerarMes,
    )
    .map((charge) => {
      const ref = refs.get(charge.dedupeKey);
      const account =
        charge.billingAccountId !== null
          ? accountById.get(charge.billingAccountId)
          : undefined;
      // Counterparty chain: account → direct counterparty (third_party) or
      // via the rent contract.
      let counterpartyId = account?.counterpartyId ?? null;
      if (counterpartyId === null && account?.contractId) {
        counterpartyId =
          contractById.get(account.contractId)?.counterpartyId ?? null;
      }
      const parceiro =
        counterpartyId !== null
          ? (counterpartyById.get(counterpartyId)?.name ?? null)
          : null;

      return {
        chargeId: charge.id,
        stationId: charge.stationId,
        stationName:
          charge.stationId !== null
            ? (stationById.get(charge.stationId)?.name ?? null)
            : null,
        matchStatus: charge.matchStatus,
        competencia: charge.competencia,
        kind: charge.kind,
        parceiro,
        amount: charge.amount,
        expectedAmount: charge.expectedAmount,
        status: charge.status,
        paymentMethod: charge.paymentMethod,
        notaFiscal: charge.notaFiscal,
        source: charge.source,
        dedupeKey: charge.dedupeKey,
        notes: charge.notes,
        chargeUuid: ref?.uuid ?? null,
        flags: charge.flags ?? [],
        statusSource: charge.statusSource ?? null,
        lastActorEmail: ref?.lastActorEmail ?? null,
        lastActorAt: ref?.lastActorAt ?? null,
        payment: summarizeLinks(
          links.byDedupeKey.get(charge.dedupeKey) ??
            links.byChargeUuid.get(charge.id),
        ),
      };
    });
}

async function PagamentosContent() {
  const viewer = await getViewer();
  let snapshot: LoadedSnapshot;
  try {
    snapshot = await getRepository().getSnapshot();
  } catch {
    return (
      <>
        <PageHeader
          title="Pagamentos"
          description="Ledger mensal de cobranças por estação — aluguel e energia"
        />
        <Alert variant="destructive">
          <CircleAlert strokeWidth={2} />
          <AlertTitle>Não foi possível carregar os pagamentos</AlertTitle>
          <AlertDescription>
            Falha ao ler a planilha de pagamentos. Recarregue a página para
            tentar novamente.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const [refs, links] = await Promise.all([readChargeRefs(), readPaymentLinks()]);

  return (
    <PagamentosView
      rows={buildRows(snapshot, refs, links)}
      canWrite={viewer.role !== null}
      isAdmin={viewer.role === "admin"}
    />
  );
}

function PagamentosSkeleton() {
  return (
    <>
      <div className="flex items-start justify-between pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <DataTableSkeleton />
    </>
  );
}

export default function PagamentosPage() {
  return (
    <Suspense fallback={<PagamentosSkeleton />}>
      <PagamentosContent />
    </Suspense>
  );
}
