import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import { deriveFaturasAArrumar } from "@/components/revisao/faturas-a-arrumar-data";
import { FaturasAArrumarTable } from "@/components/revisao/faturas-a-arrumar-table";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { getRepository } from "@/lib/data/repository.server";
import { readChargeRefs } from "@/app/(app)/pagamentos/charge-refs";

export const metadata: Metadata = { title: "Faturas a arrumar" };

const DESCRIPTION =
  "Faturas de energia Enel/EDP recebidas sem vencimento, competência, valor ou nota fiscal — em quarentena (fora de /energia e /pagamentos) até serem completadas";

export default function FaturasAArrumarPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  const repo = getRepository();
  const [snapshot, freshness, refs] = await Promise.all([
    repo.getSnapshot(),
    repo.getFreshness(),
    readChargeRefs(),
  ]);

  const rows = deriveFaturasAArrumar(snapshot, refs);

  return (
    <div>
      <PageHeader
        title="Faturas a arrumar"
        description={DESCRIPTION}
        actions={<FreshnessDot timestamp={freshness.maxScrapedAt} label="Última coleta" />}
      />
      <FaturasAArrumarTable rows={rows} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Faturas a arrumar" description={DESCRIPTION} />
      <DataTableSkeleton rows={4} />
    </div>
  );
}
