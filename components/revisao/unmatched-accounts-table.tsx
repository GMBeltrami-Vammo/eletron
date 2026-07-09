"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { StatusBadge } from "@/components/vammo/status-badge";
import type {
  AccountType,
  MatchStatus,
  UtilityBillStatus,
} from "@/lib/domain";
import type { MatchCandidate } from "@/lib/matching/suggest";
import { formatBRL } from "@/lib/format";
import {
  ACCOUNT_TYPE_UI,
  MATCH_STATUS_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";

import { MatchActions, type StationChoice } from "./match-actions";

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
  /** Geodesic station suggestions (R4) — empty when the account has no coords. */
  suggestions: MatchCandidate[];
}

export function UnmatchedAccountsTable({
  rows,
  stations,
}: {
  rows: UnmatchedAccountRow[];
  stations: StationChoice[];
}) {
  const columns = React.useMemo<ColumnDef<UnmatchedAccountRow, unknown>[]>(
    () => [
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
        id: "vinculacao",
        header: "Vinculação",
        accessorFn: (row) => MATCH_STATUS_UI[row.matchStatus].label,
        cell: ({ row }) => {
          const ui = MATCH_STATUS_UI[row.original.matchStatus];
          return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
        },
      },
      {
        id: "coleta",
        header: "Coleta",
        accessorFn: (row) => row.scrapedAt ?? "",
        cell: ({ row }) => <FreshnessDot timestamp={row.original.scrapedAt} />,
      },
      {
        id: "acoes",
        header: "Vincular à estação",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <MatchActions
            billingAccountId={row.original.id}
            suggestions={row.original.suggestions}
            stations={stations}
          />
        ),
      },
    ],
    [stations],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar por instalação, endereço…"
      csvFilename="instalacoes-nao-vinculadas"
      filterableColumnIds="all"
      emptyMessage="Tudo em dia — nenhuma instalação aguardando vínculo."
    />
  );
}
