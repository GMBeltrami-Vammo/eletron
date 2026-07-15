import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/revisao/back-link";
import { DocumentoDetail } from "@/components/documentos/documento-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/components/admin/viewer";
import { readReviewQueue } from "@/app/(app)/revisao/cobrancas/queries";
import { getDocumentDeepDive } from "./queries";

export const metadata: Metadata = { title: "Documento — Eletron" };

export default function DocumentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div>
      <BackLink href="/pagamentos" label="Pagamentos" />
      <Suspense fallback={<DetailSkeleton />}>
        <DocumentoContent params={params} />
      </Suspense>
    </div>
  );
}

async function DocumentoContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // review supplies the option lists the shared editor + Nova cobrança need.
  const [data, review, viewer] = await Promise.all([
    getDocumentDeepDive(id),
    readReviewQueue(),
    getViewer(),
  ]);
  if (data.available && !data.found) notFound();
  return (
    <DocumentoDetail
      data={data}
      stations={review.stations}
      cadastros={review.cadastros}
      canWrite={viewer.role !== null}
    />
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,45%)_minmax(0,1fr)]">
      <Skeleton className="h-[72vh] w-full" />
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
