"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { TriangleAlert } from "lucide-react";

import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  ACCOUNT_TYPE_UI,
  AUTO_DEBIT_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { StationCell } from "./station-cell";
import type { InstalacaoRow } from "./types";

const CARRIED_FORWARD_CAVEAT =
  "Status pode estar defasado — carregado da última coleta com contas";

/** Typed CSV-override meta (DataTable reads `meta.csvValue`). */
function csvMeta(
  csvValue: (row: InstalacaoRow) => unknown,
): ColumnDef<InstalacaoRow, unknown>["meta"] {
  return { csvValue } as ColumnDef<InstalacaoRow, unknown>["meta"];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const columns: ColumnDef<InstalacaoRow, unknown>[] = [
  {
    id: "provedor",
    header: "Provedor",
    accessorFn: (r) => ACCOUNT_TYPE_UI[r.provider].label,
    cell: ({ row }) => {
      const ui = ACCOUNT_TYPE_UI[row.original.provider];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorFn: (r) => r.installationKey,
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.installationKey}
      </span>
    ),
  },
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (r) => r.stationId ?? -1,
    cell: ({ row }) => (
      <StationCell
        stationId={row.original.stationId}
        matchStatus={row.original.matchStatus}
      />
    ),
    meta: csvMeta((r) => r.stationId ?? `(${r.matchStatus})`),
  },
  {
    id: "endereco",
    header: "Endereço",
    accessorFn: (r) => r.address ?? "",
    cell: ({ row }) => (
      <span
        className="block max-w-[260px] truncate text-muted-foreground"
        title={row.original.address ?? undefined}
      >
        {row.original.address ?? "—"}
      </span>
    ),
  },
  {
    id: "statusFatura",
    header: "Status fatura",
    accessorFn: (r) =>
      r.billStatus ? UTILITY_BILL_STATUS_UI[r.billStatus].label : "",
    cell: ({ row }) => {
      const { billStatus, isStatusCarriedForward } = row.original;
      if (!billStatus) return <span className="text-muted-foreground">—</span>;
      const ui = UTILITY_BILL_STATUS_UI[billStatus];
      return (
        <span className="inline-flex items-center gap-1">
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          {isStatusCarriedForward ? (
            <TriangleAlert
              className="size-3.5 text-warning-emphasis"
              strokeWidth={2}
              aria-label={CARRIED_FORWARD_CAVEAT}
            >
              <title>{CARRIED_FORWARD_CAVEAT}</title>
            </TriangleAlert>
          ) : null}
        </span>
      );
    },
    meta: csvMeta((r) =>
      r.billStatus
        ? `${UTILITY_BILL_STATUS_UI[r.billStatus].label}${r.isStatusCarriedForward ? " (defasado)" : ""}`
        : "",
    ),
  },
  {
    id: "ultimaFatura",
    header: "Última fatura (R$)",
    accessorFn: (r) => r.lastBilling ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.lastBilling)}
      </span>
    ),
    meta: csvMeta((r) => r.lastBilling ?? ""),
  },
  {
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (r) => r.dueDate ?? "",
    cell: ({ row }) => {
      const { dueDate, billStatus } = row.original;
      const overdue =
        dueDate !== null && dueDate < todayIso() && billStatus !== "paga";
      return (
        <span
          className={cn(
            "tabular-nums",
            overdue && "font-medium text-error-emphasis",
          )}
        >
          {formatDate(dueDate)}
        </span>
      );
    },
  },
  {
    id: "debitoAutomatico",
    header: "Débito automático",
    accessorFn: (r) => AUTO_DEBIT_UI[r.autoDebit].label,
    cell: ({ row }) => {
      const ui = AUTO_DEBIT_UI[row.original.autoDebit];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "negociadas",
    header: "Negociadas",
    accessorFn: (r) => r.negotiatedCount,
    cell: ({ row }) => {
      const { negotiatedCount, negotiatedCompetencias } = row.original;
      if (negotiatedCount === 0) {
        return <span className="block text-right text-muted-foreground">—</span>;
      }
      return (
        <span
          className="flex items-center justify-end gap-1"
          title={negotiatedCompetencias.map(formatCompetencia).join(", ")}
        >
          <span className="tabular-nums">{negotiatedCount}</span>
          {negotiatedCompetencias.slice(0, 2).map((c) => (
            <StatusBadge key={c} color="orange" outline>
              {formatCompetencia(c)}
            </StatusBadge>
          ))}
        </span>
      );
    },
  },
  {
    id: "desligamento",
    header: "Desligamento",
    accessorFn: (r) => r.shutdownDate ?? "",
    cell: ({ row }) =>
      row.original.shutdownDate ? (
        <StatusBadge color="orange">
          {formatDate(row.original.shutdownDate)}
        </StatusBadge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "primeiraColeta",
    header: "Primeira coleta",
    accessorFn: (r) => r.firstSeenAt ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDate(row.original.firstSeenAt)}</span>
    ),
  },
  {
    id: "coleta",
    header: "Coleta",
    accessorFn: (r) => r.scrapedAt ?? "",
    cell: ({ row }) => <FreshnessDot timestamp={row.original.scrapedAt} />,
  },
  // Hidden by default (column-visibility menu — excess of info via toggles).
  {
    id: "email",
    header: "E-mail da conta",
    accessorFn: (r) => r.accountEmail ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.accountEmail ?? "—"}
      </span>
    ),
  },
  {
    id: "registroDa",
    header: "Registro DA",
    accessorFn: (r) => r.autoDebitRegistration ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.autoDebitRegistration ?? "—"}
      </span>
    ),
  },
  {
    id: "cidade",
    header: "Cidade",
    accessorFn: (r) => r.city ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.city ?? "—"}</span>
    ),
  },
  {
    id: "bairro",
    header: "Bairro",
    accessorFn: (r) => r.neighborhood ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.neighborhood ?? "—"}
      </span>
    ),
  },
  {
    id: "latLon",
    header: "Lat/Lon",
    accessorFn: (r) =>
      r.lat !== null && r.lon !== null ? `${r.lat}, ${r.lon}` : "",
    cell: ({ row }) => {
      const { lat, lon } = row.original;
      return (
        <span className="tabular-nums text-muted-foreground">
          {lat !== null && lon !== null ? `${lat}, ${lon}` : "—"}
        </span>
      );
    },
  },
];

const HIDDEN_BY_DEFAULT = {
  email: false,
  registroDa: false,
  cidade: false,
  bairro: false,
  latLon: false,
};

export function InstalacoesTable({ rows }: { rows: InstalacaoRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar instalação, endereço…"
      csvFilename="instalacoes-energia"
      initialSorting={[{ id: "estacao", desc: false }]}
      initialColumnVisibility={HIDDEN_BY_DEFAULT}
      // Spreadsheet-style header funnels (multi-select checklists).
      filterableColumnIds={[
        "provedor",
        "statusFatura",
        "debitoAutomatico",
        "cidade",
        "bairro",
      ]}
      emptyMessage="Nenhuma instalação encontrada."
    />
  );
}
