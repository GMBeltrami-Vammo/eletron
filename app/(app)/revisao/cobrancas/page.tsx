import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import { CobrancasReview } from "@/components/revisao/cobrancas-review";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { readReviewQueue } from "./queries";

export const metadata: Metadata = { title: "Revisão de cobranças" };

const DESCRIPTION =
  "Cobranças de e-mail classificadas pela IA — confira e, se preciso, reclassifique antes de aprovar";

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
  const queue = await readReviewQueue();

  return (
    <div>
      <PageHeader
        title="Revisão de cobranças"
        description={DESCRIPTION}
      />
      <CobrancasReview
        rows={queue.rows}
        stations={queue.stations}
        cadastros={queue.cadastros}
        mergeTargets={queue.mergeTargets}
        available={queue.available}
      />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Revisão de cobranças" description={DESCRIPTION} />
      <DataTableSkeleton />
    </div>
  );
}
