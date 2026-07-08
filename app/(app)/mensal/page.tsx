import { Suspense } from "react";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { MensalView } from "@/components/mensal/mensal-view";
import { getRepository } from "@/lib/data/repository.server";
import { deriveMonthlyMatrix } from "@/lib/mensal/derive";
import type { LoadedSnapshot, FreshnessInfo } from "@/lib/data/repository";

export const metadata: Metadata = { title: "Mensal — Eletron" };

const DESCRIPTION =
  "Visão mensal por estação: energia e aluguel pagos, o que falta e onde está parado";

/** Distinct competência months present in the snapshot, newest first. */
function monthsFrom(snapshot: LoadedSnapshot): string[] {
  const set = new Set<string>();
  for (const c of snapshot.charges) {
    if (c.competencia) set.add(c.competencia.slice(0, 7));
  }
  return [...set].sort().reverse();
}

export default function MensalPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  return (
    <div>
      <PageHeader title="Mensal" description={DESCRIPTION} />
      <Suspense fallback={<DataTableSkeleton />}>
        <MensalContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function MensalContent({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;

  let snapshot: LoadedSnapshot;
  let freshness: FreshnessInfo;
  try {
    const repo = getRepository();
    [snapshot, freshness] = await Promise.all([
      repo.getSnapshot(),
      repo.getFreshness(),
    ]);
  } catch {
    return (
      <Alert variant="destructive">
        <CircleAlert strokeWidth={2} />
        <AlertTitle>Não foi possível carregar a visão mensal</AlertTitle>
        <AlertDescription>
          Falha ao ler os dados. Recarregue a página para tentar novamente.
        </AlertDescription>
      </Alert>
    );
  }

  const months = monthsFrom(snapshot);
  const valid = m && /^\d{4}-\d{2}$/.test(m) ? m : null;
  const month =
    valid ?? months[0] ?? new Date(freshness.fetchedAt).toISOString().slice(0, 7);
  const matrix = deriveMonthlyMatrix(snapshot, month);
  // ensure the picker always includes the selected month
  const pickerMonths = months.includes(month) ? months : [month, ...months];

  return (
    <MensalView
      matrix={matrix}
      months={pickerMonths}
      month={month}
      frozenAt={freshness.byProvider.enel.maxScrapedAt ?? freshness.maxScrapedAt}
    />
  );
}

export const dynamic = "force-dynamic";
