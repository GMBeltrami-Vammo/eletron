import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, Handshake, Home, Receipt, Zap } from "lucide-react";

import { getRepository } from "@/lib/data/repository.server";
import { readPaymentLinks, summarizeLinks } from "@/lib/data/payment-links";
import type { PaymentLinkSummary } from "@/lib/data/payment-links.shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/vammo/page-header";
import { StatusBadge } from "@/components/vammo/status-badge";
import { STATION_STATUS_UI } from "@/lib/labels";
import { FreshnessRibbon } from "@/components/estacao/freshness-ribbon";
import { IdentityCard } from "@/components/estacao/identity-card";
import { StationSkeleton } from "@/components/estacao/station-skeleton";
import { StationTabs } from "@/components/estacao/station-tabs";
import type { Station360 } from "@/lib/data/repository";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Estação #${id} · Eletron` };
}

export default async function StationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const stationId = Number(id);
  if (!Number.isInteger(stationId)) notFound();

  return (
    <Suspense fallback={<StationSkeleton />}>
      <StationContent stationId={stationId} />
    </Suspense>
  );
}

async function StationContent({ stationId }: { stationId: number }) {
  const repo = getRepository();
  const [data, freshness, links] = await Promise.all([
    repo.getStation(stationId),
    repo.getFreshness(),
    readPaymentLinks(),
  ]);
  if (data === null) notFound();

  // R1: charge dedupeKey → linked-payment summary for this station's charges.
  const payments: Record<string, PaymentLinkSummary | null> = {};
  for (const charge of data.charges) {
    const summary = summarizeLinks(
      links.byDedupeKey.get(charge.dedupeKey) ?? links.byChargeUuid.get(charge.id),
    );
    if (summary) payments[charge.dedupeKey] = summary;
  }

  const { station, rollup } = data;
  const statusUi = station.status ? STATION_STATUS_UI[station.status] : null;

  return (
    <div>
      <PageHeader
        title={`#${station.id} — ${station.name ?? "Sem nome"}`}
        actions={
          <>
            <Button
              variant="outline"
              render={<Link href={`/leituras/nova?station=${station.id}`} />}
            >
              <Camera className="size-4" strokeWidth={2} aria-hidden />
              Nova leitura
            </Button>
            {/* Phase 1 is read-only — mutation lands with Supabase in Phase 2. */}
            <span title="Disponível na fase 2">
              <Button disabled>
                <Receipt className="size-4" strokeWidth={2} aria-hidden />
                Registrar pagamento
              </Button>
            </span>
          </>
        }
      />

      {/* Status badge + source chips (PageHeader only takes a string title). */}
      <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2">
        {statusUi ? (
          <StatusBadge color={statusUi.color}>{statusUi.label}</StatusBadge>
        ) : (
          <StatusBadge color="grey" outline>
            Sem status
          </StatusBadge>
        )}
        <SourceChips data={data} />
      </div>

      <FreshnessRibbon
        hasEnel={rollup.sources.enel > 0}
        hasEdp={rollup.sources.edp > 0}
        enelScrapedAt={stalestScrapedAt(data, "energy_enel")}
        edpScrapedAt={stalestScrapedAt(data, "energy_edp")}
        fetchedAt={freshness.fetchedAt}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="w-full shrink-0 lg:w-72">
          <IdentityCard data={data} />
        </div>
        <div className="min-w-0 flex-1">
          <StationTabs
            data={data}
            fetchedAt={freshness.fetchedAt}
            payments={payments}
          />
        </div>
      </div>
    </div>
  );
}

/** Stalest scrape time across the station's accounts of one provider. */
function stalestScrapedAt(
  data: Station360,
  accountType: "energy_enel" | "energy_edp",
): string | null {
  const times = data.accounts
    .filter((a) => a.account.accountType === accountType)
    .map((a) => a.state?.scrapedAt)
    .filter((t): t is string => t != null)
    .sort();
  return times[0] ?? null;
}

function SourceChips({ data }: { data: Station360 }) {
  const { sources } = data.rollup;
  const chips: Array<{
    key: string;
    icon: React.ReactNode;
    label: string;
  }> = [];
  if (sources.enel > 0) {
    chips.push({
      key: "enel",
      icon: <Zap className="size-3" strokeWidth={2} aria-hidden />,
      label: sources.enel > 1 ? `Enel ×${sources.enel}` : "Enel",
    });
  }
  if (sources.edp > 0) {
    chips.push({
      key: "edp",
      icon: <Zap className="size-3" strokeWidth={2} aria-hidden />,
      label: sources.edp > 1 ? `EDP ×${sources.edp}` : "EDP",
    });
  }
  if (sources.rent > 0) {
    chips.push({
      key: "rent",
      icon: <Home className="size-3" strokeWidth={2} aria-hidden />,
      label: "Aluguel",
    });
  }
  if (sources.thirdParty > 0) {
    chips.push({
      key: "3p",
      icon: <Handshake className="size-3" strokeWidth={2} aria-hidden />,
      label: sources.thirdParty > 1 ? `Terceiro ×${sources.thirdParty}` : "Terceiro",
    });
  }

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {chip.icon}
          {chip.label}
        </span>
      ))}
    </>
  );
}
