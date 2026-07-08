"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Camera } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";

/**
 * Candidate-station row for /leituras: ACTIVE stations that have never had a
 * meter reading. Each row deep-links into the capture flow with the station
 * preselected. (Stations that DO have readings are shown in the readings table
 * + completeness matrix above, not here.)
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
    id: "ultimaColeta",
    header: "Última coleta",
    accessorFn: (r) => r.freshness ?? "",
    cell: ({ row }) => <FreshnessDot timestamp={row.original.freshness} />,
  },
  {
    id: "acao",
    header: "",
    enableSorting: false,
    accessorFn: () => "",
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-7 bg-card"
          render={<Link href={`/leituras/nova?station=${row.original.id}`} />}
        >
          <Camera className="size-3.5" strokeWidth={2} />
          Nova leitura
        </Button>
      </div>
    ),
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
      emptyMessage="Todas as estações ativas já têm leitura."
    />
  );
}
