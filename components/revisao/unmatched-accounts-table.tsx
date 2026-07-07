"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { StatusBadge } from "@/components/vammo/status-badge";
import type {
  AccountType,
  MatchStatus,
  UtilityBillStatus,
} from "@/lib/domain";
import { formatBRL, formatDate } from "@/lib/format";
import {
  ACCOUNT_TYPE_UI,
  MATCH_STATUS_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";

import { Phase2Button } from "./phase2-button";

/** Unmatched billing account joined to its scraper state (server-built). */
export interface UnmatchedAccountRow {
  id: string;
  accountType: AccountType;
  externalKey: string;
  matchStatus: MatchStatus;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  providerStationStatus: string | null;
  billStatus: UtilityBillStatus | null;
  lastBilling: number | null;
  dueDate: string | null;
  firstSeenAt: string | null;
  scrapedAt: string | null;
  notes: string | null;
}

const columns: ColumnDef<UnmatchedAccountRow, unknown>[] = [
  {
    id: "provedor",
    header: "Provedor",
    accessorFn: (row) => ACCOUNT_TYPE_UI[row.accountType].label,
    cell: ({ row }) => {
      const ui = ACCOUNT_TYPE_UI[row.original.accountType];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorKey: "externalKey",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{String(getValue())}</span>
    ),
  },
  {
    id: "endereco",
    header: "Endereço (concessionária)",
    accessorFn: (row) =>
      [row.address, row.neighborhood, row.city].filter(Boolean).join(" · ") ||
      "—",
    cell: ({ row }) => {
      const { address, neighborhood, city } = row.original;
      if (!address && !neighborhood && !city) {
        return <span className="text-muted-foreground">—</span>;
      }
      const sub = [neighborhood, city].filter(Boolean).join(" · ");
      return (
        <span className="block max-w-80 whitespace-normal">
          <span>{address ?? "—"}</span>
          {sub ? (
            <span className="block text-xs text-muted-foreground">{sub}</span>
          ) : null}
        </span>
      );
    },
  },
  {
    id: "statusPortal",
    header: "Status portal",
    accessorFn: (row) => row.providerStationStatus ?? "—",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">{String(getValue())}</span>
    ),
  },
  {
    id: "fatura",
    header: "Fatura",
    accessorFn: (row) =>
      row.billStatus ? UTILITY_BILL_STATUS_UI[row.billStatus].label : "—",
    cell: ({ row }) => {
      const status = row.original.billStatus;
      if (!status) return <span className="text-muted-foreground">—</span>;
      const ui = UTILITY_BILL_STATUS_UI[status];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "ultimaFatura",
    header: "Última fatura",
    accessorFn: (row) => row.lastBilling ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.lastBilling)}
      </span>
    ),
    meta: { csvValue: (row: UnmatchedAccountRow) => row.lastBilling },
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
    id: "vinculacao",
    header: "Vinculação",
    accessorFn: (row) => MATCH_STATUS_UI[row.matchStatus].label,
    cell: ({ row }) => {
      const ui = MATCH_STATUS_UI[row.original.matchStatus];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "primeiraColeta",
    header: "Primeira coleta",
    accessorFn: (row) => row.firstSeenAt ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDate(row.original.firstSeenAt)}</span>
    ),
  },
  {
    id: "coleta",
    header: "Coleta",
    accessorFn: (row) => row.scrapedAt ?? "",
    cell: ({ row }) => <FreshnessDot timestamp={row.original.scrapedAt} />,
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
      <div className="flex justify-end">
        <Phase2Button size="xs">Vincular</Phase2Button>
      </div>
    ),
  },
];

export function UnmatchedAccountsTable({
  rows,
}: {
  rows: UnmatchedAccountRow[];
}) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar por instalação, endereço…"
      csvFilename="instalacoes-nao-vinculadas"
      initialColumnVisibility={{ observacoes: false, primeiraColeta: false }}
      emptyMessage="Tudo em dia — nenhuma instalação aguardando vínculo."
    />
  );
}
