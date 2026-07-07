"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";

/**
 * Candidate-station row for the Phase 1 /leituras list. No readings exist yet
 * (registro chega na fase 2), so última leitura / dias desde leitura render as
 * placeholders — the columns already exist so the Phase 2 data drops in
 * without a layout change.
 */
export interface LeituraStationRow {
  id: number;
  name: string | null;
  address: string | null;
  /** min(scrapedAt) across the station's utility accounts (StationRollup). */
  freshness: string | null;
}

const columns: ColumnDef<LeituraStationRow, unknown>[] = [
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (r) => `${r.id} ${r.name ?? ""}`.trim(),
    sortingFn: (a, b) => a.original.id - b.original.id,
    cell: ({ row }) => (
      <Link
        href={`/estacoes/${row.original.id}`}
        className="font-medium text-foreground hover:underline"
      >
        <span className="tabular-nums">{row.original.id}</span>
        {row.original.name ? ` — ${row.original.name}` : ""}
      </Link>
    ),
  },
  {
    id: "endereco",
    header: "Endereço",
    accessorFn: (r) => r.address ?? "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.address ?? "—"}
      </span>
    ),
  },
  {
    id: "ultimaLeitura",
    header: "Última leitura",
    enableSorting: false,
    accessorFn: () => "",
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: "diasDesdeLeitura",
    header: "Dias desde leitura",
    enableSorting: false,
    accessorFn: () => "",
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: "ultimaColeta",
    header: "Última coleta",
    accessorFn: (r) => r.freshness ?? "",
    cell: ({ row }) => <FreshnessDot timestamp={row.original.freshness} />,
  },
];

export function LeiturasTable({ rows }: { rows: LeituraStationRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar estação ou endereço…"
      initialSorting={[{ id: "estacao", desc: false }]}
      csvFilename="leituras-estacoes-candidatas"
      emptyMessage="Nenhuma estação ativa encontrada."
    />
  );
}
