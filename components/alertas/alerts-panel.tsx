"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { StatusBadge } from "@/components/vammo/status-badge";
import { Phase2Button } from "@/components/revisao/phase2-button";
import type { AlertSeverity } from "@/lib/domain";
import { ALERT_TYPE_UI } from "@/lib/labels";
import { cn } from "@/lib/utils";

import {
  ALERT_SEVERITY_UI,
  CORE_ALERT_TYPES,
  SEVERITY_ORDER,
  alertDetail,
  installationLabel,
  type AlertRow,
} from "./alert-ui";

const columns: ColumnDef<AlertRow, unknown>[] = [
  {
    id: "categoria",
    header: "Categoria",
    accessorFn: (row) => ALERT_TYPE_UI[row.alertType]?.label ?? row.alertType,
    cell: ({ row }) => {
      const ui = ALERT_TYPE_UI[row.original.alertType];
      return ui ? (
        <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
      ) : (
        <span>{row.original.alertType}</span>
      );
    },
  },
  {
    id: "severidade",
    header: "Severidade",
    accessorFn: (row) => ALERT_SEVERITY_UI[row.severity].label,
    cell: ({ row }) => {
      const ui = ALERT_SEVERITY_UI[row.original.severity];
      return (
        <StatusBadge color={ui.color} outline>
          {ui.label}
        </StatusBadge>
      );
    },
  },
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (row) =>
      row.stationId !== null
        ? `#${row.stationId}${row.stationName ? ` ${row.stationName}` : ""}`
        : "—",
    cell: ({ row }) => {
      const { stationId, stationName } = row.original;
      if (stationId === null) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <Link
          href={`/estacoes/${stationId}`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="tabular-nums">#{stationId}</span>
          {stationName ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {stationName}
            </span>
          ) : null}
        </Link>
      );
    },
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorFn: (row) => installationLabel(row.billingAccountId) ?? "—",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {String(getValue())}
      </span>
    ),
  },
  {
    id: "detalhe",
    header: "Detalhe",
    accessorFn: (row) => alertDetail(row),
    cell: ({ getValue }) => (
      <span className="block max-w-96 whitespace-normal text-muted-foreground">
        {String(getValue())}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    // Phase 1 alerts are recomputed on every snapshot and are always open;
    // the acknowledge/resolve lifecycle lands with the Phase 2 database.
    accessorFn: () => "Ativo",
    cell: () => (
      <StatusBadge color="red" outline>
        Ativo
      </StatusBadge>
    ),
  },
  {
    id: "acoes",
    enableSorting: false,
    enableHiding: false,
    cell: () => (
      <div className="flex justify-end gap-1">
        <Phase2Button size="xs">Reconhecer</Phase2Button>
        <Phase2Button size="xs">Resolver</Phase2Button>
      </div>
    ),
  },
];

export function AlertsPanel({
  rows,
  lastScrapedAt,
}: {
  rows: AlertRow[];
  lastScrapedAt: string | null;
}) {
  const [category, setCategory] = React.useState<string | null>(null);
  const [severity, setSeverity] = React.useState<AlertSeverity | null>(null);

  const countByType = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.alertType, (map.get(row.alertType) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  // The 7 core categories always render; extra categories (irregularity
  // joins etc.) appear only when present in the evaluated alerts.
  const cardTypes = React.useMemo(() => {
    const core: readonly string[] = CORE_ALERT_TYPES;
    const extras = Array.from(countByType.keys())
      .filter((type) => !core.includes(type))
      .sort();
    return [...core, ...extras];
  }, [countByType]);

  const filtered = React.useMemo(
    () =>
      rows.filter(
        (row) =>
          (category === null || row.alertType === category) &&
          (severity === null || row.severity === severity),
      ),
    [rows, category, severity],
  );

  return (
    <div>
      <PageHeader
        title="Alertas"
        description="Calculado sobre a última coleta"
        actions={<FreshnessDot timestamp={lastScrapedAt} label="Última coleta" />}
      />

      <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cardTypes.map((type) => {
          const ui = ALERT_TYPE_UI[type];
          const count = countByType.get(type) ?? 0;
          const selected = category === type;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={selected}
              onClick={() => setCategory(selected ? null : type)}
              className={cn(
                "rounded-xl border-l-4 bg-card p-4 text-left ring-1 ring-foreground/10 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selected && "ring-2 ring-primary",
              )}
              style={{
                borderLeftColor: `var(--badge-${ui?.color ?? "grey"}-bg)`,
              }}
            >
              <div className="text-xs font-medium text-muted-foreground">
                {ui?.label ?? type}
              </div>
              <div
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums",
                  count === 0 && "text-muted-foreground",
                )}
              >
                {count}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {ui?.description ?? ""}
              </p>
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Buscar por estação, instalação…"
        csvFilename="alertas"
        filterableColumnIds="all"
        toolbarLeft={
          <div className="flex flex-wrap items-center gap-1">
            {SEVERITY_ORDER.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={severity === level ? "secondary" : "ghost"}
                onClick={() =>
                  setSeverity(severity === level ? null : level)
                }
              >
                {ALERT_SEVERITY_UI[level].label}
              </Button>
            ))}
            {category !== null ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setCategory(null)}
              >
                {ALERT_TYPE_UI[category]?.label ?? category}
                <X className="size-3" strokeWidth={2} />
              </Button>
            ) : null}
          </div>
        }
        emptyMessage={
          rows.length === 0
            ? "Tudo em dia — nenhum alerta ativo."
            : "Nenhum alerta com os filtros atuais."
        }
      />
    </div>
  );
}
