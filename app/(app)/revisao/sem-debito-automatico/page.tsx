import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import { EnelEdpSemDaTable } from "@/components/revisao/irregularities-tables";
import { deriveEnelEdpSemDa } from "@/components/revisao/sem-da-data";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { getRepository } from "@/lib/data/repository.server";

export const metadata: Metadata = { title: "Contas sem débito automático" };

const DESCRIPTION =
  "Contas de energia Enel/EDP cuja estação ainda não está em débito automático — perseguir o cadastro em DA";

export default function SemDebitoAutomaticoPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <SemDaContent />
      </Suspense>
    </div>
  );
}

async function SemDaContent() {
  const repo = getRepository();
  const [snapshot, freshness] = await Promise.all([
    repo.getSnapshot(),
    repo.getFreshness(),
  ]);

  const rows = deriveEnelEdpSemDa(snapshot);

  return (
    <div>
      <PageHeader
        title="Contas Enel/EDP sem débito automático registrado"
        description={DESCRIPTION}
        actions={
          <FreshnessDot timestamp={freshness.maxScrapedAt} label="Última coleta" />
        }
      />
      <EnelEdpSemDaTable rows={rows} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Contas Enel/EDP sem débito automático registrado" description={DESCRIPTION} />
      <DataTableSkeleton rows={6} />
    </div>
  );
}
