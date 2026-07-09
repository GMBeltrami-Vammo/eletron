import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import { ContratosReview } from "@/components/revisao/contratos-review";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { readContratoQueue } from "./queries";

export const metadata: Metadata = { title: "Revisão de contratos" };

const DESCRIPTION =
  "Contratos de aluguel extraídos pela IA — confira e confirme para criar o cadastro";

export default function ContratosPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <ContratosContent />
      </Suspense>
    </div>
  );
}

async function ContratosContent() {
  const queue = await readContratoQueue();

  return (
    <div>
      <PageHeader
        title="Revisão de contratos"
        description={DESCRIPTION}
      />
      <ContratosReview
        rows={queue.rows}
        stations={queue.stations}
        available={queue.available}
      />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Revisão de contratos" description={DESCRIPTION} />
      <DataTableSkeleton />
    </div>
  );
}
