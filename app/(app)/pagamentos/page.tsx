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
import { resolveDocumentHref } from "@/lib/data/document-href";
import { energyCicloStage, energyCicloIsPaid } from "@/lib/energia/ciclo";
import { SETTLED_CHARGE_STATUSES } from "@/lib/ingest/derive";
import type { LoadedSnapshot } from "@/lib/data/repository";
import { getViewer } from "@/components/admin/viewer";
import { readReviewQueue } from "@/app/(app)/revisao/cobrancas/queries";
import { readEnergyAccounts } from "@/components/energia/energy-accounts";
import { readChargeRefs, type ChargeRef } from "./charge-refs";

export const metadata: Metadata = { title: "Pagamentos — Eletron" };

/**
 * Unified ledger rows = ALL charges (decision "unify all payments here").
 * Rent + third-party (sheet_backfill / gerar_mes) AND Enel/EDP energy invoices
 * (scraper_enel / scraper_edp) — the view splits them into two tabs by
 * account type. Energy rows carry no counterparty (concessionária isn't a
 * partner), so `accountType` lets the view show a provider label instead.
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
  // Energy fatura PDF links live on the energy detail, keyed by charge id
  // (= dedupeKey); the same pattern energia/page.tsx uses for its PDF column.
  const detailsByCharge = new Map(
    snapshot.chargeEnergyDetails.map((d) => [d.chargeId, d]),
  );
  // Débito automático lives on the energy account's utility state (null for
  // rent/third-party, which have no utility state row).
  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((s) => [s.billingAccountId, s]),
  );

  return snapshot.charges
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
      const counterparty =
        counterpartyId !== null ? counterpartyById.get(counterpartyId) : undefined;
      const cpName = counterparty?.name ?? null;
      const cpCnpj = counterparty?.cnpjCpf ?? null;
      // The ingest stores the CNPJ digits as `name` when the razão social was
      // empty (normalize.ts upsertCounterparty). Detect that fallback and drop
      // it so the Parceiro column shows a real name or nothing — the digits go
      // to the dedicated CNPJ column instead.
      const onlyDigits = (s: string) => s.replace(/\D/g, "");
      const parceiro =
        cpName && !(cpCnpj && onlyDigits(cpName) === onlyDigits(cpCnpj))
          ? cpName
          : null;

      const state =
        charge.billingAccountId !== null
          ? stateByAccount.get(charge.billingAccountId)
          : undefined;
      const payment = summarizeLinks(
        links.byDedupeKey.get(charge.dedupeKey) ??
          links.byChargeUuid.get(charge.id),
      );
      // Ciclo "Paga" (#29, Gabriel 2026-07-18): for ENERGY, a bare settled
      // status (the clone's portal-derived 'pago') is NOT paid — only a bound
      // comprovante or a R$0-settled fatura (#42) is. Rent/third-party keep the
      // looser rule (casa_vammo/gratuito auto-pago has no comprovante by design).
      const settled = SETTLED_CHARGE_STATUSES.has(charge.status);
      const isEnergyCharge =
        account?.accountType === "energy_enel" ||
        account?.accountType === "energy_edp";
      const ciclo = energyCicloStage({
        hasBillSignal: true,
        hasParsedCharge: charge.amount !== null,
        fiscalExported:
          (charge.fiscalExported ?? false) ||
          (detailsByCharge.get(charge.id)?.fiscalExported ?? false),
        isPaid: isEnergyCharge
          ? energyCicloIsPaid({
              settled,
              amount: charge.amount,
              hasComprovante: payment?.documentId != null,
            })
          : settled || payment?.documentId != null,
      });

      return {
        chargeId: charge.id,
        stationId: charge.stationId,
        stationName:
          charge.stationId !== null
            ? (stationById.get(charge.stationId)?.name ?? null)
            : null,
        stationAddress:
          charge.stationId !== null
            ? (stationById.get(charge.stationId)?.address ?? null)
            : null,
        contractRentAmount:
          (account?.contractId
            ? (contractById.get(account.contractId)?.valorMensal ?? null)
            : null) ?? null,
        matchStatus: charge.matchStatus,
        competencia: charge.competencia,
        dueDate: charge.dueDate,
        autoDebit: state?.autoDebit ?? null,
        kind: charge.kind,
        parceiro,
        cnpj: cpCnpj,
        billStatus: state?.billStatus ?? null,
        ciclo,
        accountType: account?.accountType ?? null,
        installationKey: account?.enelId ?? account?.edpUc ?? null,
        amount: charge.amount,
        expectedAmount: charge.expectedAmount,
        status: charge.status,
        paymentMethod: charge.paymentMethod,
        notaFiscal: charge.notaFiscal,
        linhaDigitavel: charge.linhaDigitavel,
        chavePix: charge.chavePix,
        source: charge.source,
        dedupeKey: charge.dedupeKey,
        notes: charge.notes,
        chargeUuid: ref?.uuid ?? null,
        flags: charge.flags ?? [],
        fiscalExported: charge.fiscalExported ?? false,
        statusSource: charge.statusSource ?? null,
        lastActorEmail: ref?.lastActorEmail ?? null,
        lastActorAt: ref?.lastActorAt ?? null,
        payment,
        documentHref: resolveDocumentHref(
          charge.sourceDocumentId ?? null,
          detailsByCharge.get(charge.id)?.faturaDriveUrl ?? null,
        ),
        sourceDocumentId: charge.sourceDocumentId ?? null,
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

  // review feeds the "Documentos de e-mail" staging tab (#47); it degrades to
  // {available:false} without Supabase env — the staging exclusion reads
  // matchStatus/source from the SNAPSHOT rows, so hidden stays hidden anyway.
  const [refs, links, review, energyAccounts] = await Promise.all([
    readChargeRefs(),
    readPaymentLinks(),
    readReviewQueue(),
    readEnergyAccounts(),
  ]);

  const stations = snapshot.stations
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.id - b.id);

  return (
    <PagamentosView
      rows={buildRows(snapshot, refs, links)}
      stations={stations}
      energyAccounts={energyAccounts}
      review={review}
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
