import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { ComprovanteDetail } from "@/components/comprovantes/comprovante-detail";
import {
  getDeepDiveData,
  getViewerContext,
} from "@/components/comprovantes/queries";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Comprovante" };

export default async function ComprovanteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  // ?page=N deep-link (R1 — ledger comprovante chips land on the receipt's page)
  const parsedPage = Number(page);
  const initialPage =
    Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  return (
    <div>
      <Link
        href="/comprovantes"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
        Comprovantes
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <DetailContent documentId={id} initialPage={initialPage} />
      </Suspense>
    </div>
  );
}

async function DetailContent({
  documentId,
  initialPage,
}: {
  documentId: string;
  initialPage: number;
}) {
  const [data, viewer] = await Promise.all([
    getDeepDiveData(documentId),
    getViewerContext(),
  ]);
  // A genuinely missing document (backend reachable) is a 404; when Supabase is
  // absent the client renders a notice instead of crashing.
  if (data.available && !data.found) notFound();

  return (
    <ComprovanteDetail
      documentId={documentId}
      initialData={data}
      viewer={viewer}
      initialPage={initialPage}
    />
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,45%)_minmax(0,1fr)]">
      <Skeleton className="h-[72vh] w-full" />
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}
