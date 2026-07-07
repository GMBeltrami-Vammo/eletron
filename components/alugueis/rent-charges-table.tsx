"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL, formatCompetencia } from "@/lib/format";
import { CHARGE_STATUS_UI } from "@/lib/labels";
import type { ChargeStatus } from "@/lib/domain";

/** Plain-JSON row precomputed on the server (contract detail page). */
export interface RentChargeRow {
  id: string;
  competencia: string | null;
  amount: number | null;
  status: ChargeStatus;
}

const columns: ColumnDef<RentChargeRow, unknown>[] = [
  {
    id: "competencia",
    header: "Competência",
    accessorFn: (r) => r.competencia ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCompetencia(row.original.competencia)}
      </span>
    ),
    meta: { csvValue: (r: RentChargeRow) => r.competencia ?? "" },
  },
  {
    id: "amount",
    header: "Valor",
    accessorFn: (r) => r.amount,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.amount)}
      </span>
    ),
    meta: { csvValue: (r: RentChargeRow) => r.amount ?? "" },
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => CHARGE_STATUS_UI[r.status].label,
    cell: ({ row }) => {
      const ui = CHARGE_STATUS_UI[row.original.status];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
];

export function RentChargesTable({
  rows,
  csvFilename,
}: {
  rows: RentChargeRow[];
  csvFilename: string;
}) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar competência…"
      csvFilename={csvFilename}
      initialSorting={[{ id: "competencia", desc: true }]}
      pageSize={12}
      emptyMessage="Nenhuma cobrança de aluguel encontrada para este contrato."
    />
  );
}
