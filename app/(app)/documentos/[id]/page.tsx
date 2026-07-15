import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/revisao/back-link";
import { DocumentoDetail } from "@/components/documentos/documento-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewer } from "@/components/admin/viewer";
import { readReviewQueue } from "@/app/(app)/revisao/cobrancas/queries";
import {
  buildEmailDocGroups,
  isEmailDocRow,
} from "@/components/pagamentos/email-docs-groups";
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

  // Prev/next navigation across the "Documentos de e-mail" list, in the SAME
  // order as the tab (buildEmailDocGroups, receivedAt desc), so the user can
  // flip through boletos without going back. Null when this doc isn't in that
  // list (e.g. reached from the ledger) — nav simply hides.
  const docIds = buildEmailDocGroups(review.rows.filter(isEmailDocRow))
    .map((g) => g.documentId)
    .filter((x): x is string => !!x);
  const idx = docIds.indexOf(id);
  const prevId = idx > 0 ? docIds[idx - 1] : null;
  const nextId = idx >= 0 && idx < docIds.length - 1 ? docIds[idx + 1] : null;
  const position = idx >= 0 ? { current: idx + 1, total: docIds.length } : null;

  return (
    <DocumentoDetail
      data={data}
      stations={review.stations}
      cadastros={review.cadastros}
      canWrite={viewer.role !== null}
      prevId={prevId}
      nextId={nextId}
      position={position}
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
