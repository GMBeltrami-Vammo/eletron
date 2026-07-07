/**
 * /estacoes — Stations dashboard (ux-screens.md §2).
 * Async server page: loads the rollup + KPI aggregates from the repository
 * and hands plain data to the client table. ?filtro= deep links are handled
 * client-side (useSearchParams) so KPI clicks re-filter without a reload.
 */

import Link from "next/link";
import { Suspense } from "react";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/vammo/page-header";
import { loadEstacoesPageData } from "@/components/estacoes/estacoes-data";
import { EstacoesSkeleton } from "@/components/estacoes/estacoes-skeleton";
import { KpiStrip } from "@/components/estacoes/kpi-strip";
import { StationsTable } from "@/components/estacoes/stations-table";
import { formatDateTime, hoursSince, relativeTime } from "@/lib/format";

export const metadata = { title: "Estações — Eletron" };

/** Persistent yellow banner when the ENEL scrape is older than 48h (spec §2). */
function StaleBanner({ enelMaxScrapedAt }: { enelMaxScrapedAt: string | null }) {
  const hours = hoursSince(enelMaxScrapedAt);
  if (hours !== null && hours <= 48) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-subtle px-3 py-2 text-sm text-warning-emphasis">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div>
        <span className="font-medium">
          {enelMaxScrapedAt
            ? `Dados da Enel coletados pela última vez em ${formatDateTime(enelMaxScrapedAt)} (${relativeTime(enelMaxScrapedAt)}).`
            : "Nenhuma coleta da Enel encontrada nos dados carregados."}
        </span>{" "}
        Os status e valores abaixo podem estar desatualizados.
      </div>
    </div>
  );
}

async function EstacoesContent() {
  let data: Awaited<ReturnType<typeof loadEstacoesPageData>>;
  try {
    data = await loadEstacoesPageData();
  } catch {
    return (
      <Alert variant="destructive">
        <TriangleAlert strokeWidth={2} />
        <AlertTitle>Não foi possível carregar as estações</AlertTitle>
        <AlertDescription>
          Falha ao ler os dados da planilha. Recarregue a página para tentar
          novamente; se persistir, verifique o acesso ao Google Sheets.{" "}
          <Link href="/estacoes">Tentar novamente</Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <StaleBanner enelMaxScrapedAt={data.kpis.enelMaxScrapedAt} />
      <KpiStrip kpis={data.kpis} />
      <StationsTable rows={data.rows} />
    </div>
  );
}

export default function EstacoesPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Estações"
        description="Visão financeira por estação: energia, aluguel e alertas."
      />
      <Suspense fallback={<EstacoesSkeleton />}>
        <EstacoesContent />
      </Suspense>
    </div>
  );
}
