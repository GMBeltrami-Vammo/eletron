import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import {
  UnmatchedChargesTable,
  type UnmatchedChargeRow,
} from "@/components/revisao/unmatched-charges-table";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { getRepository } from "@/lib/data/repository.server";

export const metadata: Metadata = { title: "Cobranças não identificadas" };

const DESCRIPTION =
  "Cobranças que chegaram sem contrato ou estação correspondente (UNIDENTIFIED)";

export default function CobrancasPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <CobrancasContent />
      </Suspense>
    </div>
  );
}

async function CobrancasContent() {
  const repo = getRepository();
  const [irregularities, freshness] = await Promise.all([
    repo.getIrregularities(),
    repo.getFreshness(),
  ]);

  const rows: UnmatchedChargeRow[] = irregularities.unmatchedCharges.map(
    (charge) => ({
      id: charge.id,
      dedupeKey: charge.dedupeKey,
      kind: charge.kind,
      competencia: charge.competencia,
      amount: charge.amount,
      expectedAmount: charge.expectedAmount,
      dueDate: charge.dueDate,
      status: charge.status,
      matchStatus: charge.matchStatus,
      issuerCnpj: charge.issuerCnpj,
      documentoNumero: charge.documentoNumero,
      notaFiscal: charge.notaFiscal,
      source: charge.source,
      sourceTab: charge.legacyRef?.tab ?? null,
      notes: charge.notes,
    }),
  );

  return (
    <div>
      <PageHeader
        title="Cobranças não identificadas"
        description={DESCRIPTION}
        actions={
          <FreshnessDot
            timestamp={freshness.maxScrapedAt}
            label="Última coleta"
          />
        }
      />
      <UnmatchedChargesTable rows={rows} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader
        title="Cobranças não identificadas"
        description={DESCRIPTION}
      />
      <DataTableSkeleton />
    </div>
  );
}
