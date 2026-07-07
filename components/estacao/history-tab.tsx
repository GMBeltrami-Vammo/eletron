"use client";

import { Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import type { BadgeColor } from "@/components/vammo/status-badge";
import {
  ALERT_TYPE_UI,
  CHARGE_KIND_UI,
  CHARGE_STATUS_UI,
} from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";

import { EmptyState } from "./empty-state";
import { alertDate, alertDetail } from "./helpers";

interface TimelineEvent {
  key: string;
  /** ISO date used for ordering; null = undated (rendered last). */
  date: string | null;
  chipLabel: string;
  chipColor: BadgeColor;
  title: string;
  detail: string;
}

/** Merged station timeline: alerts + charges. Audit events arrive in Phase 2. */
export function HistoryTab({ data }: { data: Station360 }) {
  const events: TimelineEvent[] = [];

  for (const charge of data.charges) {
    const kindUi = CHARGE_KIND_UI[charge.kind];
    events.push({
      key: `charge:${charge.id}`,
      date: charge.dueDate ?? charge.competencia,
      chipLabel: kindUi.label,
      chipColor: kindUi.color,
      title: `Cobrança ${formatCompetencia(charge.competencia)}`,
      detail: [formatBRL(charge.amount), CHARGE_STATUS_UI[charge.status].label]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const alert of data.alerts) {
    const ui = ALERT_TYPE_UI[alert.alertType];
    events.push({
      key: `alert:${alert.id}`,
      date: alertDate(alert),
      chipLabel: ui?.label ?? alert.alertType,
      chipColor: ui?.color ?? "grey",
      title: ui?.description ?? alert.alertType,
      detail: alertDetail(alert),
    });
  }

  events.sort((a, b) => {
    if (a.date === null && b.date === null) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return b.date.localeCompare(a.date);
  });

  if (events.length === 0) {
    return (
      <EmptyState
        icon={Info}
        title="Nenhum evento registrado"
        description="Cobranças e alertas desta estação aparecem aqui conforme são coletados."
      />
    );
  }

  return (
    <div className="space-y-3">
      <Card size="sm">
        <CardContent>
          <ol className="relative space-y-0 border-l border-border pl-4">
            {events.map((event) => (
              <li key={event.key} className="relative py-2.5">
                <span
                  className="absolute top-4 -left-[21.5px] size-2.5 rounded-full border-2 border-card"
                  style={{
                    backgroundColor: `var(--badge-${event.chipColor}-bg)`,
                  }}
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {event.date ? formatDate(event.date) : "—"}
                  </span>
                  <StatusBadge color={event.chipColor}>
                    {event.chipLabel}
                  </StatusBadge>
                  <span className="font-medium">{event.title}</span>
                  {event.detail ? (
                    <span className="text-xs text-muted-foreground">
                      {event.detail}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        Eventos de auditoria (quem marcou pago, edições de contrato) ficam
        disponíveis na fase 2.
      </p>
    </div>
  );
}
