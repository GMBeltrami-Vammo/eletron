"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { ComprovanteCell } from "@/components/vammo/comprovante-cell";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL, formatCompetencia } from "@/lib/format";
import { CHARGE_STATUS_UI, MATCH_STATUS_UI } from "@/lib/labels";
import type { PaymentLinkSummary } from "@/lib/data/payment-links.shared";
import type { ChargeStatus, IngestSource, MatchStatus } from "@/lib/domain";

/** Ingest source → chip label (R1 — requests 3/4: Gerado / E-mail / Manual). */
const RENT_SOURCE_LABEL: Partial<Record<IngestSource, string>> = {
  gerar_mes: "Gerado",
  email_ai: "E-mail",
  manual: "Manual",
  sheet_backfill: "Planilha",
};

/** Plain-JSON row precomputed on the server (contract detail page). */
export interface RentChargeRow {
  id: string;
  competencia: string | null;
  amount: number | null;
  status: ChargeStatus;
  /** R1 chips: provenance + review state + linked comprovante. */
  source: IngestSource;
  matchStatus: MatchStatus;
  payment: PaymentLinkSummary | null;
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
  {
    id: "origem",
    header: "Origem",
    accessorFn: (r) => RENT_SOURCE_LABEL[r.source] ?? r.source,
    cell: ({ row }) => (
      <StatusBadge color="grey" outline>
        {RENT_SOURCE_LABEL[row.original.source] ?? row.original.source}
      </StatusBadge>
    ),
  },
  {
    id: "revisao",
    header: "Revisão",
    accessorFn: (r) =>
      r.matchStatus === "needs_review" ? "Precisa de revisão" : "",
    cell: ({ row }) =>
      row.original.matchStatus === "needs_review" ? (
        <StatusBadge color={MATCH_STATUS_UI.needs_review.color}>
          {MATCH_STATUS_UI.needs_review.label}
        </StatusBadge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "comprovante",
    header: "Comprovante",
    accessorFn: (r) => (r.payment ? "Vinculado" : ""),
    cell: ({ row }) => (
      <ComprovanteCell
        dedupeKey={row.original.id}
        amount={row.original.amount}
        summary={row.original.payment}
      />
    ),
    meta: { csvValue: (r: RentChargeRow) => (r.payment ? "vinculado" : "") },
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
      filterableColumnIds="all"
      emptyMessage="Nenhuma cobrança de aluguel encontrada para este contrato."
    />
  );
}
