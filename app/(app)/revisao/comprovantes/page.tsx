import type { Metadata } from "next";
import { Suspense } from "react";

import { BackLink } from "@/components/revisao/back-link";
import { ReviewQueue } from "@/components/comprovantes/review-queue";
import {
  getReviewData,
  getViewerContext,
} from "@/components/comprovantes/queries";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";

export const metadata: Metadata = { title: "Comprovantes não conciliados" };

const DESCRIPTION =
  "Recibos sem correspondência ou ambíguos — concilie com a cobrança certa";

export default function ComprovantesRevisaoPage() {
  return (
    <div>
      <BackLink />
      <PageHeader title="Comprovantes não conciliados" description={DESCRIPTION} />
      <Suspense fallback={<DataTableSkeleton />}>
        <RevisaoContent />
      </Suspense>
    </div>
  );
}

async function RevisaoContent() {
  const [data, viewer] = await Promise.all([
    getReviewData(),
    getViewerContext(),
  ]);
  return <ReviewQueue initialData={data} viewer={viewer} />;
}
