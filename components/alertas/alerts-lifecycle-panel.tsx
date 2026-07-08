"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AuditByline } from "@/components/vammo/audit-byline";
import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { StatusBadge } from "@/components/vammo/status-badge";
import { FacetFilter } from "@/components/alugueis/facet-filter";
import type { AlertSeverity, AlertStatus } from "@/lib/domain";
import { ALERT_TYPE_UI } from "@/lib/labels";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  ALERT_SEVERITY_UI,
  SEVERITY_ORDER,
  alertDetail,
  installationLabel,
} from "./alert-ui";
import {
  ALERT_LIFECYCLE_LABEL,
  LIFECYCLE_FILTERS,
  allowedActions,
  lifecycleColor,
  type AlertActionKind,
  type LifecycleAlertRow,
} from "./alert-lifecycle-ui";
import { AlertActionDialog, RowActionsMenu } from "./lifecycle-actions";

export function AlertsLifecyclePanel({
  rows,
  lastScrapedAt,
  canWrite,
}: {
  rows: LifecycleAlertRow[];
  lastScrapedAt: string | null;
  canWrite: boolean;
}) {
  const [lifecycle, setLifecycle] = React.useState<AlertStatus | "all">("open");
  const [severity, setSeverity] = React.useState<AlertSeverity | null>(null);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<{
    mode: AlertActionKind | null;
    ids: string[];
  }>({ mode: null, ids: [] });

  const countByLifecycle = React.useMemo(() => {
    const map = new Map<AlertStatus, number>();
    for (const r of rows) map.set(r.status, (map.get(r.status) ?? 0) + 1);
    return map;
  }, [rows]);

  const categoryOptions = React.useMemo(() => {
    const present = Array.from(new Set(rows.map((r) => r.alertType)));
    return present
      .map((type) => ({
        value: type,
        label: ALERT_TYPE_UI[type]?.label ?? type,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          (lifecycle === "all" || r.status === lifecycle) &&
          (severity === null || r.severity === severity) &&
          (categories.length === 0 || categories.includes(r.alertType)),
      ),
    [rows, lifecycle, severity, categories],
  );

  const selectableIds = React.useMemo(
    () => filtered.filter((r) => allowedActions(r.status).length > 0).map((r) => r.id),
    [filtered],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const toggleAll = React.useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allSelected, selectableIds]);
  function openDialog(mode: AlertActionKind, ids: string[]) {
    setDialog({ mode, ids });
  }

  const columns = React.useMemo<ColumnDef<LifecycleAlertRow, unknown>[]>(() => {
    const cols: ColumnDef<LifecycleAlertRow, unknown>[] = [];
    if (canWrite) {
      cols.push({
        id: "select",
        enableSorting: false,
        enableHiding: false,
        header: () => (
          <Checkbox
            aria-label="Selecionar todos"
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onCheckedChange={toggleAll}
            disabled={selectableIds.length === 0}
          />
        ),
        cell: ({ row }) =>
          allowedActions(row.original.status).length > 0 ? (
            <Checkbox
              aria-label="Selecionar alerta"
              checked={selected.has(row.original.id)}
              onCheckedChange={() => toggle(row.original.id)}
            />
          ) : null,
      });
    }
    cols.push(
      {
        id: "categoria",
        header: "Categoria",
        accessorFn: (r) => ALERT_TYPE_UI[r.alertType]?.label ?? r.alertType,
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
        accessorFn: (r) => ALERT_SEVERITY_UI[r.severity].label,
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
        accessorFn: (r) =>
          r.stationId !== null
            ? `#${r.stationId}${r.stationName ? ` ${r.stationName}` : ""}`
            : "—",
        cell: ({ row }) => {
          const { stationId, stationName } = row.original;
          if (stationId === null)
            return <span className="text-muted-foreground">—</span>;
          return (
            <Link
              href={`/estacoes/${stationId}`}
              className="font-medium hover:underline"
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
        accessorFn: (r) => installationLabel(r.billingAccountId) ?? "—",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {String(getValue())}
          </span>
        ),
      },
      {
        id: "detalhe",
        header: "Detalhe",
        accessorFn: (r) => alertDetail(r),
        cell: ({ getValue }) => (
          <span className="block max-w-96 whitespace-normal text-muted-foreground">
            {String(getValue())}
          </span>
        ),
      },
      {
        id: "ciclo",
        header: "Situação",
        accessorFn: (r) => ALERT_LIFECYCLE_LABEL[r.status],
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="space-y-0.5">
              <StatusBadge color={lifecycleColor(r.status, r.severity)}>
                {ALERT_LIFECYCLE_LABEL[r.status]}
              </StatusBadge>
              {r.status === "open" ? (
                <span className="block text-xs text-muted-foreground">
                  detectado {relativeTime(r.firstDetectedAt)}
                </span>
              ) : (
                <AuditByline
                  actorEmail={r.actorEmail}
                  at={r.actorAt}
                  className="block"
                />
              )}
              {r.note ? (
                <span
                  className="block max-w-72 truncate text-xs text-muted-foreground italic"
                  title={r.note}
                >
                  {r.note}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "acoes",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <RowActionsMenu
              status={row.original.status}
              canWrite={canWrite}
              onAction={(kind) => openDialog(kind, [row.original.id])}
            />
          </div>
        ),
      },
    );
    return cols;
    // selection/derived flags are captured intentionally so checkboxes re-render.
  }, [canWrite, selected, allSelected, someSelected, selectableIds, toggleAll]);

  const selectedCount = selected.size;

  return (
    <div>
      <PageHeader
        title="Alertas"
        description="Calculado sobre a última coleta"
        actions={<FreshnessDot timestamp={lastScrapedAt} label="Última coleta" />}
      />

      {/* Lifecycle filter chip row (default Ativos) */}
      <div className="flex flex-wrap items-center gap-1 pb-3">
        {LIFECYCLE_FILTERS.map((f) => {
          const count =
            f.value === "all" ? rows.length : (countByLifecycle.get(f.value) ?? 0);
          return (
            <Button
              key={f.value}
              size="sm"
              variant={lifecycle === f.value ? "secondary" : "ghost"}
              onClick={() => setLifecycle(f.value)}
            >
              {f.label}
              <span className="ml-1 rounded bg-muted px-1 text-xs tabular-nums">
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {/* Bulk action bar */}
      {canWrite && selectedCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm">
          <span className="font-medium tabular-nums">
            {selectedCount} selecionado(s)
          </span>
          <div className="ml-auto flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog("acknowledge", [...selected])}
            >
              Reconhecer
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog("resolve", [...selected])}
            >
              Resolver
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog("mute", [...selected])}
            >
              Silenciar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Limpar
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Buscar por estação, instalação…"
        csvFilename="alertas"
        rowClassName={(r) =>
          cn(selected.has(r.id) && "bg-primary/5")
        }
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
            {categoryOptions.length > 0 ? (
              <FacetFilter
                label="Categoria"
                options={categoryOptions}
                selected={categories}
                onChange={setCategories}
              />
            ) : null}
          </div>
        }
        emptyMessage={
          rows.length === 0
            ? "Nenhum alerta persistido."
            : "Nenhum alerta com os filtros atuais."
        }
      />

      <AlertActionDialog
        mode={dialog.mode}
        targetIds={dialog.ids}
        onClose={() => setDialog({ mode: null, ids: [] })}
        onDone={() => setSelected(new Set())}
      />
    </div>
  );
}
