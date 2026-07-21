"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { ExternalLink, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import type { ContractType, StationStatus } from "@/lib/domain";
import { formatBRL, formatDate } from "@/lib/format";
import { CONTRACT_TYPE_UI, STATION_STATUS_UI } from "@/lib/labels";

import { Phase2Button } from "./phase2-button";

/** Station live in Metabase without a rent cadastro (server-built). */
export interface StationWithoutContractRow {
  stationId: number | null;
  stationName: string | null;
  address: string | null;
  status: StationStatus | null;
  sourceCreatedAt: string | null;
}

/** Cadastro whose station vanished or was never matched (server-built). */
export interface ContractWithoutStationRow {
  contractId: string;
  cadastroId: number | null;
  address: string | null;
  stationId: number | null;
  contractType: ContractType | null;
  valorMensal: number | null;
  contactName: string | null;
}

const stationColumns: ColumnDef<StationWithoutContractRow, unknown>[] = [
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (row) =>
      row.stationId !== null
        ? `#${row.stationId}${row.stationName ? ` ${row.stationName}` : ""}`
        : "—",
    cell: ({ row }) => {
      const { stationId, stationName } = row.original;
      if (stationId === null) {
        return <span className="text-muted-foreground">—</span>;
      }
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
    id: "endereco",
    header: "Endereço",
    accessorFn: (row) => row.address ?? "—",
    cell: ({ getValue }) => (
      <span className="block max-w-96 whitespace-normal">
        {String(getValue())}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (row) =>
      row.status ? STATION_STATUS_UI[row.status].label : "—",
    cell: ({ row }) => {
      const status = row.original.status;
      if (!status) return <span className="text-muted-foreground">—</span>;
      const ui = STATION_STATUS_UI[status];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "criadaEm",
    header: "Criada em",
    accessorFn: (row) => row.sourceCreatedAt ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatDate(row.original.sourceCreatedAt)}
      </span>
    ),
  },
  {
    id: "acoes",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const { stationId } = row.original;
      // Deep-link to Novo contrato with the station already resolved — drop the
      // PDF (or fill manually) with the estação pré-selecionada.
      const href =
        stationId !== null
          ? `/alugueis/novo?station=${stationId}`
          : "/alugueis/novo";
      return (
        <div className="flex justify-end">
          <Button size="xs" variant="outline" render={<Link href={href} />}>
            <Plus className="size-3.5" strokeWidth={2} />
            Criar contrato
          </Button>
        </div>
      );
    },
  },
];

const contractColumns: ColumnDef<ContractWithoutStationRow, unknown>[] = [
  {
    id: "cadastro",
    header: "Cadastro",
    accessorFn: (row) =>
      row.cadastroId !== null ? `#${row.cadastroId}` : row.contractId,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{String(getValue())}</span>
    ),
  },
  {
    id: "endereco",
    header: "Endereço",
    accessorFn: (row) => row.address ?? "—",
    cell: ({ getValue }) => (
      <span className="block max-w-96 whitespace-normal">
        {String(getValue())}
      </span>
    ),
  },
  {
    id: "estacaoRef",
    header: "Estação (ref.)",
    accessorFn: (row) =>
      row.stationId !== null ? `#${row.stationId} inexistente` : "sem estação",
    cell: ({ row }) => {
      const stationId = row.original.stationId;
      if (stationId === null) {
        return <span className="text-muted-foreground">sem estação</span>;
      }
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="tabular-nums">#{stationId}</span>
          <StatusBadge color="red" outline>
            inexistente
          </StatusBadge>
        </span>
      );
    },
  },
  {
    id: "tipoContrato",
    header: "Tipo de contrato",
    accessorFn: (row) =>
      row.contractType ? CONTRACT_TYPE_UI[row.contractType].label : "—",
    cell: ({ row }) => {
      const type = row.original.contractType;
      if (!type) return <span className="text-muted-foreground">—</span>;
      const ui = CONTRACT_TYPE_UI[type];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "valorMensal",
    header: "Valor mensal",
    accessorFn: (row) => row.valorMensal ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.valorMensal)}
      </span>
    ),
    meta: { csvValue: (row: ContractWithoutStationRow) => row.valorMensal },
  },
  {
    id: "contato",
    header: "Contato",
    accessorFn: (row) => row.contactName ?? "—",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{String(getValue())}</span>
    ),
  },
  {
    id: "acoes",
    enableSorting: false,
    enableHiding: false,
    cell: () => (
      <div className="flex justify-end gap-1">
        <Phase2Button size="xs">Marcar desativada</Phase2Button>
        <Phase2Button size="xs">Corrigir estação</Phase2Button>
      </div>
    ),
  },
];

export function StationsWithoutContractTable({
  rows,
}: {
  rows: StationWithoutContractRow[];
}) {
  return (
    <DataTable
      columns={stationColumns}
      data={rows}
      searchPlaceholder="Buscar estação…"
      csvFilename="estacoes-sem-contrato"
      pageSize={25}
      filterableColumnIds="all"
      emptyMessage="Tudo em dia — nenhuma estação sem contrato."
    />
  );
}

/** Enel/EDP energy account whose station is NOT registered for débito automático. */
export interface EnelEdpSemDaRow {
  /** Swap-station id — the "ID" on /estações. */
  vammoId: number | null;
  stationName: string | null;
  /** Enel id / EDP UC — the "Instalação" on /energia. */
  installationKey: string | null;
  provider: "Enel" | "EDP";
  address: string | null;
  autoDebitRegistration: string | null;
  lastBillValue: number | null;
  /** Vencimento da última fatura de energia da conta (ISO). */
  lastBillDueDate: string | null;
  /** Link do Drive da última fatura, se disponível. */
  lastBillFaturaUrl: string | null;
  lastBillFiscalExported: boolean;
}

const semDaColumns: ColumnDef<EnelEdpSemDaRow, unknown>[] = [
  {
    id: "vammoId",
    header: "ID (estação)",
    accessorFn: (row) => row.vammoId ?? -1,
    cell: ({ row }) => {
      const { vammoId, stationName } = row.original;
      if (vammoId === null) return <span className="text-muted-foreground">—</span>;
      return (
        <Link href={`/estacoes/${vammoId}`} className="font-medium hover:underline">
          <span className="tabular-nums">#{vammoId}</span>
          {stationName ? (
            <span className="font-normal text-muted-foreground"> · {stationName}</span>
          ) : null}
        </Link>
      );
    },
  },
  {
    id: "provedor",
    header: "Provedor",
    accessorFn: (row) => row.provider,
    cell: ({ row }) => (
      <StatusBadge color={row.original.provider === "Enel" ? "blue" : "dark-green"}>
        {row.original.provider}
      </StatusBadge>
    ),
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorFn: (row) => row.installationKey ?? "—",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{String(getValue())}</span>
    ),
  },
  {
    id: "endereco",
    header: "Endereço",
    accessorFn: (row) => row.address ?? "—",
    cell: ({ getValue }) => (
      <span className="block max-w-96 whitespace-normal">{String(getValue())}</span>
    ),
  },
  {
    id: "registroDa",
    header: "Registro DA",
    accessorFn: (row) => row.autoDebitRegistration ?? "—",
    cell: ({ row }) =>
      row.original.autoDebitRegistration ? (
        <span className="font-mono text-xs tabular-nums">
          {row.original.autoDebitRegistration}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "ultimoValor",
    header: "Último valor",
    accessorFn: (row) => row.lastBillValue ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.lastBillValue)}
      </span>
    ),
    meta: { csvValue: (row: EnelEdpSemDaRow) => row.lastBillValue },
  },
  {
    id: "ultimoVencimento",
    header: "Último vencimento",
    accessorFn: (row) => row.lastBillDueDate ?? "",
    cell: ({ row }) =>
      row.original.lastBillDueDate ? (
        <span className="tabular-nums">{formatDate(row.original.lastBillDueDate)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "ultimoFiscal",
    header: "Última ao fiscal",
    accessorFn: (row) => (row.lastBillFiscalExported ? "Sim" : "Não"),
    cell: ({ row }) => (
      <StatusBadge color={row.original.lastBillFiscalExported ? "green" : "grey"} outline>
        {row.original.lastBillFiscalExported ? "Sim" : "Não"}
      </StatusBadge>
    ),
  },
  {
    id: "ultimaFatura",
    header: "Última fatura (PDF)",
    enableSorting: false,
    accessorFn: (row) => row.lastBillFaturaUrl ?? "",
    cell: ({ row }) =>
      row.original.lastBillFaturaUrl ? (
        <a
          href={row.original.lastBillFaturaUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Ver fatura
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function EnelEdpSemDaTable({ rows }: { rows: EnelEdpSemDaRow[] }) {
  return (
    <DataTable
      columns={semDaColumns}
      data={rows}
      searchPlaceholder="Buscar estação, instalação, endereço…"
      csvFilename="enel-edp-sem-debito-automatico"
      pageSize={25}
      filterableColumnIds="all"
      emptyMessage="Nenhuma conta de energia sem débito automático."
    />
  );
}

export function ContractsWithoutStationTable({
  rows,
}: {
  rows: ContractWithoutStationRow[];
}) {
  return (
    <DataTable
      columns={contractColumns}
      data={rows}
      searchPlaceholder="Buscar cadastro…"
      csvFilename="contratos-sem-estacao"
      pageSize={25}
      filterableColumnIds="all"
      emptyMessage="Tudo em dia — nenhum contrato sem estação."
    />
  );
}
