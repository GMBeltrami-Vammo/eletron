"use client";

/**
 * Monthly matrix + metrics view (R3, request 5). Month picker → group summary
 * cards (ambas / só energia / só aluguel / nenhuma) → per-station matrix with
 * the energy & rent state + "where is it stuck" drilldown → cost metrics
 * (kWh, box) with top-N. Energy figures carry the frozen-data caveat.
 */

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Snowflake } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/vammo/data-table";
import { StatCard } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import type { BadgeColor } from "@/components/vammo/status-badge";
import { formatBRL, formatCompetencia, formatDateTime } from "@/lib/format";
import type {
  MonthGroup,
  MonthlyMatrix,
  SideResult,
  SideState,
  StationMonthRow,
} from "@/lib/mensal/derive";

const SIDE_UI: Record<SideState, { label: string; color: BadgeColor }> = {
  paga: { label: "Paga", color: "green" },
  conciliada: { label: "Conciliada", color: "green" },
  aguardando_da: { label: "Aguardando DA", color: "blue" },
  boleto_recebido: { label: "Boleto recebido", color: "orange" },
  em_aberto: { label: "Em aberto", color: "red" },
  sem_cobranca: { label: "Sem cobrança", color: "red" },
  cobranca_manual: { label: "Cobrança manual", color: "blue" },
  gratuito: { label: "Gratuito", color: "green" },
  na: { label: "—", color: "grey" },
};

const GROUP_UI: Record<
  MonthGroup,
  { label: string; tone: "success" | "warning" | "error" | "default" }
> = {
  ambas: { label: "Ambas pagas", tone: "success" },
  so_energia: { label: "Só energia", tone: "warning" },
  so_aluguel: { label: "Só aluguel", tone: "warning" },
  nenhuma: { label: "Nenhuma paga", tone: "error" },
  sem_obrigacoes: { label: "Sem obrigações", tone: "default" },
};

const GROUP_FILTERS: MonthGroup[] = ["ambas", "so_energia", "so_aluguel", "nenhuma"];

function SideCell({ side }: { side: SideResult }) {
  if (!side.applies) {
    return <span className="text-muted-foreground">—</span>;
  }
  const ui = SIDE_UI[side.state];
  return (
    <div className="space-y-0.5">
      <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
      {side.detail ? (
        <span className="block text-xs text-muted-foreground">{side.detail}</span>
      ) : null}
    </div>
  );
}

export function MensalView({
  matrix,
  months,
  month,
  frozenAt,
}: {
  matrix: MonthlyMatrix;
  months: string[];
  month: string;
  /** Freshness of the (frozen) energy data — the clone date. */
  frozenAt: string | null;
}) {
  const [group, setGroup] = React.useState<MonthGroup | "all">("all");

  const setMonth = React.useCallback((m: string) => {
    // month is a server search param — navigate so the server re-derives
    const url = new URL(window.location.href);
    url.searchParams.set("m", m);
    window.location.assign(url.toString());
  }, []);

  const rows = React.useMemo(
    () => (group === "all" ? matrix.rows : matrix.rows.filter((r) => r.group === group)),
    [matrix.rows, group],
  );

  const columns = React.useMemo<ColumnDef<StationMonthRow, unknown>[]>(
    () => [
      {
        id: "estacao",
        header: "Estação",
        accessorFn: (r) => r.stationName ?? String(r.stationId),
        cell: ({ row }) => (
          <a
            href={`/estacoes/${row.original.stationId}`}
            className="font-medium underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{row.original.stationId} {row.original.stationName ?? ""}
          </a>
        ),
      },
      {
        id: "energia",
        header: "Energia",
        accessorFn: (r) => r.energy.state,
        cell: ({ row }) => <SideCell side={row.original.energy} />,
      },
      {
        id: "aluguel",
        header: "Aluguel",
        accessorFn: (r) => r.rent.state,
        cell: ({ row }) => <SideCell side={row.original.rent} />,
      },
      {
        id: "grupo",
        header: "Situação",
        accessorFn: (r) => GROUP_UI[r.group].label,
        cell: ({ row }) => {
          const ui = GROUP_UI[row.original.group];
          const color: BadgeColor =
            ui.tone === "success"
              ? "green"
              : ui.tone === "error"
                ? "red"
                : ui.tone === "warning"
                  ? "orange"
                  : "grey";
          return <StatusBadge color={color}>{ui.label}</StatusBadge>;
        },
      },
      {
        id: "valores",
        header: "Energia · Aluguel",
        enableSorting: false,
        accessorFn: (r) => (r.energyAmount ?? 0) + (r.rentAmount ?? 0),
        cell: ({ row }) => (
          <span className="block text-right text-xs tabular-nums text-muted-foreground">
            {formatBRL(row.original.energyAmount)} · {formatBRL(row.original.rentAmount)}
          </span>
        ),
        meta: {
          csvValue: (r: StationMonthRow) =>
            `${r.energyAmount ?? ""}/${r.rentAmount ?? ""}`,
        } as ColumnDef<StationMonthRow, unknown>["meta"],
      },
    ],
    [],
  );

  const m = matrix.metrics;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={month} onValueChange={(v) => setMonth(v as string)}>
          <SelectTrigger size="sm" className="w-44 bg-card">
            <SelectValue>{formatCompetencia(`${month}-01`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {months.map((mo) => (
              <SelectItem key={mo} value={mo}>
                {formatCompetencia(`${mo}-01`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {frozenAt ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-info/40 bg-info-subtle/30 px-2 py-1 text-xs text-info-emphasis">
            <Snowflake className="size-3.5" strokeWidth={2} />
            Dados de energia congelados em {formatDateTime(frozenAt)}
          </span>
        ) : null}
      </div>

      {/* group summary — clicking filters the table */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {GROUP_FILTERS.map((g) => (
          <button key={g} type="button" onClick={() => setGroup(group === g ? "all" : g)}>
            <StatCard
              label={GROUP_UI[g].label}
              value={matrix.groups[g]}
              tone={GROUP_UI[g].tone}
              className={group === g ? "ring-2 ring-ring" : undefined}
            />
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Buscar estação…"
        csvFilename={`mensal-${month}`}
        initialSorting={[{ id: "grupo", desc: false }]}
        filterableColumnIds="all"
        emptyMessage="Nenhuma estação com obrigações neste mês."
        toolbarLeft={
          group !== "all" ? (
            <button
              type="button"
              className="text-sm text-info-emphasis underline-offset-2 hover:underline"
              onClick={() => setGroup("all")}
            >
              Limpar filtro ({GROUP_UI[group].label})
            </button>
          ) : null
        }
      />

      {/* metrics */}
      <div id="metricas" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Métricas do mês</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total energia"
            value={formatBRL(m.energyTotal)}
            tone="info"
            sub="dados congelados"
          />
          <StatCard label="Total aluguel" value={formatBRL(m.rentTotal)} />
          <StatCard
            label="Custo médio por kWh"
            value={m.avgKwhCost != null ? formatBRL(m.avgKwhCost) : "—"}
            tone="info"
            sub={
              m.excludedKwh > 0
                ? `${m.excludedKwh} sem kWh (excluídas)`
                : "dados congelados"
            }
          />
          <StatCard
            label="Custo médio por box"
            value={m.avgBoxCost != null ? formatBRL(m.avgBoxCost) : "—"}
            sub={
              m.excludedBox > 0
                ? `${m.excludedBox} sem boxes (excluídas)`
                : "boxes atuais"
            }
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <TopList
            title="Energia mais cara (R$/kWh)"
            rows={m.kwhCostByStation.slice(0, 8)}
            unit="/kWh"
          />
          <TopList
            title="Aluguel mais caro (R$/box)"
            rows={m.boxCostByStation.slice(0, 8)}
            unit="/box"
          />
        </div>
      </div>
    </div>
  );
}

function TopList({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: { stationId: number; stationName: string | null; value: number }[];
  unit: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Sem dados suficientes.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => (
              <li key={r.stationId} className="flex items-center justify-between py-1.5">
                <a
                  href={`/estacoes/${r.stationId}`}
                  className="truncate underline-offset-2 hover:underline"
                >
                  #{r.stationId} {r.stationName ?? ""}
                </a>
                <span className="tabular-nums font-medium">
                  {formatBRL(r.value)}
                  <span className="text-xs text-muted-foreground">{unit}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
