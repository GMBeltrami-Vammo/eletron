/**
 * Section A of /estacoes — the 7-card KPI strip (ux-screens.md §2).
 * Server-safe: StatCards only, each deep-linking to a table filter or page.
 * Horizontally scrollable under xl, single grid row at xl+.
 */

import { StatCard, type StatTone } from "@/components/vammo/stat-card";
import { formatBRL, hoursSince, relativeTime } from "@/lib/format";

import type { EstacoesKpis } from "./types";

/** Scraper-card tone: yellow past 26h, red past 48h (spec thresholds). */
function scraperTone(iso: string | null): StatTone {
  const hours = hoursSince(iso);
  if (hours === null || hours > 48) return "error";
  if (hours > 26) return "warning";
  return "success";
}

export function KpiStrip({ kpis }: { kpis: EstacoesKpis }) {
  const cards: {
    key: string;
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    tone: StatTone;
    href: string;
  }[] = [
    {
      key: "ativas",
      label: "Estações ativas",
      value: `${kpis.ativas} / ${kpis.totalEstacoes}`,
      tone: "default",
      href: "/estacoes?filtro=ativas",
    },
    {
      key: "vencidas",
      label: "Faturas vencidas",
      value: kpis.vencidasCount,
      sub: formatBRL(kpis.vencidasTotal),
      tone: kpis.vencidasCount > 0 ? "error" : "success",
      href: "/estacoes?filtro=vencidas",
    },
    {
      key: "venceSemDA",
      label: "A vencer 7 dias sem DA",
      value: kpis.venceSemDaCount,
      sub: "instalações",
      tone: kpis.venceSemDaCount > 0 ? "warning" : "default",
      href: "/estacoes?filtro=venceSemDA",
    },
    {
      key: "semDA",
      label: "Sem débito automático",
      value: kpis.semDaCount,
      sub: "instalações",
      tone: "default",
      href: "/estacoes?filtro=semDA",
    },
    {
      key: "aluguelPendente",
      label: "Pagamentos pendentes no mês",
      value: kpis.rentPendingCount,
      sub: formatBRL(kpis.rentPendingTotal),
      tone: "default",
      href: "/estacoes?filtro=aluguelPendente",
    },
    {
      key: "scraper",
      label: "Scraper: última coleta",
      value: relativeTime(kpis.enelMaxScrapedAt),
      sub: `EDP: ${relativeTime(kpis.edpMaxScrapedAt)}`,
      tone: scraperTone(kpis.enelMaxScrapedAt),
      href: "/estacoes?filtro=scraperParado",
    },
    {
      key: "revisao",
      label: "Em revisão",
      value: kpis.emRevisaoCount,
      sub: "itens nas filas de revisão",
      tone: kpis.emRevisaoCount > 0 ? "info" : "default",
      href: "/revisao",
    },
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 xl:grid xl:grid-cols-7 xl:overflow-visible xl:pb-0">
      {cards.map((card) => (
        <div key={card.key} className="min-w-44 flex-1 xl:min-w-0">
          <StatCard
            label={card.label}
            value={card.value}
            sub={card.sub}
            tone={card.tone}
            href={card.href}
          />
        </div>
      ))}
    </div>
  );
}
