"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL } from "@/lib/format";
import {
  ALERT_TYPE_UI,
  CONTRACT_TYPE_UI,
  PAYMENT_METHOD_LABEL,
  STATION_STATUS_UI,
} from "@/lib/labels";
import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";

import { type ContractEndInfo } from "./contract-utils";
import { FacetFilter } from "./facet-filter";

/** Plain-JSON row precomputed on the server (page.tsx). */
export interface ContractRow {
  cadastroId: number | null;
  stationId: number | null;
  /** stationId points at a station that exists in the snapshot. */
  stationExists: boolean;
  stationName: string | null;
  parceiro: string | null;
  contractType: ContractType | null;
  formula: string | null;
  valorMensal: number | null;
  dueDay: number | null;
  paymentMethod: PaymentMethod | null;
  status: StationStatus | null;
  startsOn: string | null;
  endsOn: string | null;
  endInfo: ContractEndInfo | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** Masked on the server — full document never reaches the list. */
  cnpjCpfMasked: string | null;
}

const NO_STATUS = "sem_status";

const columns: ColumnDef<ContractRow, unknown>[] = [
  {
    id: "cadastroId",
    header: "Cadastro",
    accessorFn: (r) => r.cadastroId,
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.cadastroId ?? "—"}
      </span>
    ),
  },
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (r) =>
      r.stationExists
        ? `#${r.stationId} ${r.stationName ?? ""}`
        : "sem estação",
    cell: ({ row }) => {
      const r = row.original;
      if (r.stationId === null) {
        return (
          <StatusBadge color="grey" outline>
            Sem estação
          </StatusBadge>
        );
      }
      if (!r.stationExists) {
        return (
          <StatusBadge color={ALERT_TYPE_UI.contract_without_station.color}>
            Estação não encontrada
          </StatusBadge>
        );
      }
      return (
        <Link
          href={`/estacoes/${r.stationId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          <span className="tabular-nums">#{r.stationId}</span>
          {r.stationName ? ` ${r.stationName}` : ""}
        </Link>
      );
    },
  },
  {
    id: "parceiro",
    header: "Parceiro",
    accessorFn: (r) => r.parceiro ?? "",
    cell: ({ row }) =>
      row.original.parceiro ?? (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "tipo",
    header: "Tipo de contrato",
    accessorFn: (r) =>
      r.contractType ? CONTRACT_TYPE_UI[r.contractType].label : "",
    cell: ({ row }) => {
      const r = row.original;
      if (!r.contractType) return <span className="text-muted-foreground">—</span>;
      const ui = CONTRACT_TYPE_UI[r.contractType];
      return (
        <div className="flex flex-col gap-0.5">
          <StatusBadge color={ui.color} className="w-fit">
            {ui.label}
          </StatusBadge>
          {r.formula ? (
            <span className="text-xs text-muted-foreground">{r.formula}</span>
          ) : null}
        </div>
      );
    },
    meta: {
      csvValue: (r: ContractRow) =>
        r.contractType
          ? `${CONTRACT_TYPE_UI[r.contractType].label}${r.formula ? ` (${r.formula})` : ""}`
          : "",
    },
  },
  {
    id: "valorMensal",
    header: "Valor mensal",
    accessorFn: (r) => r.valorMensal,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.valorMensal)}
      </span>
    ),
    meta: { csvValue: (r: ContractRow) => r.valorMensal ?? "" },
  },
  {
    id: "dueDay",
    header: "Vencimento",
    accessorFn: (r) => r.dueDay,
    cell: ({ row }) =>
      row.original.dueDay !== null ? (
        <span className="tabular-nums">dia {row.original.dueDay}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "pagamento",
    header: "Pagamento",
    accessorFn: (r) =>
      r.paymentMethod ? PAYMENT_METHOD_LABEL[r.paymentMethod] : "",
    cell: ({ row }) =>
      row.original.paymentMethod ? (
        PAYMENT_METHOD_LABEL[row.original.paymentMethod]
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => (r.status ? STATION_STATUS_UI[r.status].label : ""),
    cell: ({ row }) => {
      const status = row.original.status;
      if (!status) return <span className="text-muted-foreground">—</span>;
      const ui = STATION_STATUS_UI[status];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "contactName",
    header: "Contato",
    accessorFn: (r) => r.contactName ?? "",
    cell: ({ row }) =>
      row.original.contactName ?? (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "phone",
    header: "Telefone",
    accessorFn: (r) => r.phone ?? "",
    cell: ({ row }) =>
      row.original.phone ? (
        <span className="tabular-nums">{row.original.phone}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "email",
    header: "E-mail",
    accessorFn: (r) => r.email ?? "",
    cell: ({ row }) =>
      row.original.email ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "cnpjCpf",
    header: "CNPJ/CPF",
    accessorFn: (r) => r.cnpjCpfMasked ?? "",
    cell: ({ row }) =>
      row.original.cnpjCpfMasked ? (
        <span className="tabular-nums">{row.original.cnpjCpfMasked}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

const TIPO_OPTIONS = Object.entries(CONTRACT_TYPE_UI).map(([value, ui]) => ({
  value,
  label: ui.label,
}));

const STATUS_OPTIONS = [
  ...Object.entries(STATION_STATUS_UI).map(([value, ui]) => ({
    value,
    label: ui.label,
  })),
  { value: NO_STATUS, label: "Sem status" },
];

export function ContractsTable({ rows }: { rows: ContractRow[] }) {
  const router = useRouter();
  const [tipoFilter, setTipoFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);

  const filtered = React.useMemo(
    () =>
      rows.filter((r) => {
        if (
          tipoFilter.length > 0 &&
          (r.contractType === null || !tipoFilter.includes(r.contractType))
        ) {
          return false;
        }
        if (
          statusFilter.length > 0 &&
          !statusFilter.includes(r.status ?? NO_STATUS)
        ) {
          return false;
        }
        return true;
      }),
    [rows, tipoFilter, statusFilter],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchPlaceholder="Buscar parceiro, estação, contato…"
      csvFilename="alugueis-contratos"
      initialSorting={[{ id: "cadastroId", desc: false }]}
      initialColumnVisibility={{
        contactName: false,
        phone: false,
        email: false,
        cnpjCpf: false,
      }}
      onRowClick={(row) => {
        if (row.cadastroId !== null) router.push(`/alugueis/${row.cadastroId}`);
      }}
      emptyMessage="Nenhum contrato encontrado."
      toolbarLeft={
        <>
          <FacetFilter
            label="Tipo de contrato"
            options={TIPO_OPTIONS}
            selected={tipoFilter}
            onChange={setTipoFilter}
          />
          <FacetFilter
            label="Status"
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
        </>
      }
    />
  );
}
