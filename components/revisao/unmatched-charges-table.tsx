"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import type {
  ChargeKind,
  ChargeStatus,
  IngestSource,
  MatchStatus,
} from "@/lib/domain";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import {
  CHARGE_KIND_UI,
  CHARGE_STATUS_UI,
  MATCH_STATUS_UI,
} from "@/lib/labels";

import { INGEST_SOURCE_LABEL, formatCnpjCpf } from "./labels";
import { Phase2Button } from "./phase2-button";

/** Unmatched/needs-review charge from getIrregularities() (server-built). */
export interface UnmatchedChargeRow {
  id: string;
  dedupeKey: string;
  kind: ChargeKind;
  competencia: string | null;
  amount: number | null;
  expectedAmount: number | null;
  dueDate: string | null;
  status: ChargeStatus;
  matchStatus: MatchStatus;
  issuerCnpj: string | null;
  documentoNumero: string | null;
  notaFiscal: string | null;
  source: IngestSource;
  sourceTab: string | null;
  notes: string | null;
}

const columns: ColumnDef<UnmatchedChargeRow, unknown>[] = [
  {
    id: "chave",
    header: "Chave",
    accessorKey: "dedupeKey",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{String(getValue())}</span>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    accessorFn: (row) => CHARGE_KIND_UI[row.kind].label,
    cell: ({ row }) => {
      const ui = CHARGE_KIND_UI[row.original.kind];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "competencia",
    header: "Competência",
    accessorFn: (row) => row.competencia ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCompetencia(row.original.competencia)}
      </span>
    ),
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (row) => row.amount ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.amount)}
      </span>
    ),
    meta: { csvValue: (row: UnmatchedChargeRow) => row.amount },
  },
  {
    id: "valorEsperado",
    header: "Valor esperado",
    accessorFn: (row) => row.expectedAmount ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.expectedAmount)}
      </span>
    ),
    meta: { csvValue: (row: UnmatchedChargeRow) => row.expectedAmount },
  },
  {
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (row) => row.dueDate ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDate(row.original.dueDate)}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (row) => CHARGE_STATUS_UI[row.status].label,
    cell: ({ row }) => {
      const ui = CHARGE_STATUS_UI[row.original.status];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "vinculacao",
    header: "Vinculação",
    accessorFn: (row) => MATCH_STATUS_UI[row.matchStatus].label,
    cell: ({ row }) => {
      const ui = MATCH_STATUS_UI[row.original.matchStatus];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "emissor",
    header: "Emissor (CNPJ)",
    accessorFn: (row) => formatCnpjCpf(row.issuerCnpj),
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{String(getValue())}</span>
    ),
  },
  {
    id: "documento",
    header: "Documento",
    accessorFn: (row) => row.documentoNumero ?? row.notaFiscal ?? "—",
    cell: ({ getValue }) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {String(getValue())}
      </span>
    ),
  },
  {
    id: "origem",
    header: "Origem",
    accessorFn: (row) => INGEST_SOURCE_LABEL[row.source],
    cell: ({ row }) => (
      <span className="text-xs">
        {INGEST_SOURCE_LABEL[row.original.source]}
        {row.original.sourceTab ? (
          <span className="block text-muted-foreground">
            {row.original.sourceTab}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "observacoes",
    header: "Observações",
    accessorFn: (row) => row.notes ?? "",
    cell: ({ row }) =>
      row.original.notes ? (
        <span
          className="block max-w-56 truncate text-xs text-muted-foreground"
          title={row.original.notes}
        >
          {row.original.notes}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "acoes",
    enableSorting: false,
    enableHiding: false,
    cell: () => (
      <div className="flex justify-end gap-1">
        <Phase2Button size="xs">Vincular</Phase2Button>
        <Phase2Button size="xs">Ignorar</Phase2Button>
      </div>
    ),
  },
];

export function UnmatchedChargesTable({
  rows,
}: {
  rows: UnmatchedChargeRow[];
}) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar por chave, emissor…"
      csvFilename="cobrancas-nao-identificadas"
      initialSorting={[{ id: "competencia", desc: true }]}
      initialColumnVisibility={{ valorEsperado: false, documento: false }}
      emptyMessage="Tudo em dia — nenhuma cobrança não identificada."
    />
  );
}
