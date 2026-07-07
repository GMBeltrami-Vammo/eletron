import { Clock } from "lucide-react";

import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { relativeTime } from "@/lib/format";

/**
 * Freshness ribbon under the 360° header (freshness is first-class UI).
 * Enel scrapes nightly → warn 26 h / critical 48 h; EDP is collected manually
 * → warn 7 d (168 h) / critical 21 d (504 h).
 */
export function FreshnessRibbon({
  enelScrapedAt,
  edpScrapedAt,
  hasEnel,
  hasEdp,
  fetchedAt,
}: {
  enelScrapedAt: string | null;
  edpScrapedAt: string | null;
  hasEnel: boolean;
  hasEdp: boolean;
  fetchedAt: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2">
      {hasEnel ? (
        <FreshnessDot
          timestamp={enelScrapedAt}
          label="Enel"
          warnHours={26}
          criticalHours={48}
        />
      ) : null}
      {hasEdp ? (
        <FreshnessDot
          timestamp={edpScrapedAt}
          label="EDP (manual)"
          warnHours={168}
          criticalHours={504}
        />
      ) : null}
      {!hasEnel && !hasEdp ? (
        <span className="text-xs text-muted-foreground">
          Sem instalações de energia vinculadas
        </span>
      ) : null}
      <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3" strokeWidth={2} aria-hidden />
        Dados carregados {relativeTime(fetchedAt)}
      </span>
    </div>
  );
}
