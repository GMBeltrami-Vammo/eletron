"use client";

/**
 * Column definitions for the /estacoes dense table (ux-screens.md §2 B).
 * All labels/colors come from lib/labels.ts — no local status→color maps.
 */

import Link from "next/link";
import type { ColumnDef, Row, VisibilityState } from "@tanstack/react-table";
import { Eye, EyeOff, Handshake, Home, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL, formatDate } from "@/lib/format";
import { CHARGE_STATUS, type ChargeStatus } from "@/lib/domain";
import {
  AUTO_DEBIT_UI,
  CHARGE_STATUS_UI,
  CONTRACT_TYPE_UI,
  STATION_STATUS_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";

import type { EstacaoRow } from "./types";

/** 'Em aberto' sentinel for the Aluguel (mês) facet (KPI 5 deep link). */
export const RENT_OPEN_SENTINEL = "open";

const OPEN_RENT_STATUSES: ReadonlySet<ChargeStatus> = new Set([
  CHARGE_STATUS.pendente,
  CHARGE_STATUS.boletoRecebido,
  CHARGE_STATUS.atrasado,
  CHARGE_STATUS.emCompensacao,
  CHARGE_STATUS.negociada,
]);

export const INITIAL_COLUMN_VISIBILITY: VisibilityState = {
  parceiro: false,
  cadastroId: false,
  boxes: false,
  criadaEm: false,
  latLong: false,
};

function fontesCsv(row: EstacaoRow): string {
  const parts: string[] = [];
  if (row.sources.enel > 0) parts.push(`Enel×${row.sources.enel}`);
  if (row.sources.edp > 0) parts.push(`EDP×${row.sources.edp}`);
  if (row.sources.rent > 0) parts.push(`Aluguel×${row.sources.rent}`);
  if (row.sources.thirdParty > 0) {
    parts.push(`Terceiro×${row.sources.thirdParty}`);
  }
  return parts.join(", ");
}

function fontesFilterFn(
  row: Row<EstacaoRow>,
  _columnId: string,
  value: string,
): boolean {
  const sources = row.original.sources;
  switch (value) {
    case "enel":
      return sources.enel > 0;
    case "edp":
      return sources.edp > 0;
    case "rent":
      return sources.rent > 0;
    case "third_party":
      return sources.thirdParty > 0;
    default:
      return true;
  }
}

function aluguelFilterFn(
  row: Row<EstacaoRow>,
  _columnId: string,
  value: string,
): boolean {
  const status = row.original.rentStatusCurrentMonth;
  if (value === RENT_OPEN_SENTINEL) {
    return status !== null && OPEN_RENT_STATUSES.has(status);
  }
  return status === value;
}

/** True when the ISO due date is strictly before today (local calendar day). */
function isPastDue(iso: string, today: string): boolean {
  return iso.slice(0, 10) < today;
}

export function buildColumns(
  today: string,
  onToggleHidden: (row: EstacaoRow) => void,
): ColumnDef<EstacaoRow, unknown>[] {
  return [
    {
      id: "id",
      header: "ID",
      accessorFn: (row) => row.stationId,
      cell: ({ row }) => (
        <Link
          href={`/estacoes/${row.original.stationId}`}
          className="font-medium tabular-nums text-primary underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.stationId}
        </Link>
      ),
    },
    {
      id: "estacao",
      header: "Estação",
      accessorFn: (row) => `${row.name ?? ""} ${row.address ?? ""}`.trim(),
      cell: ({ row }) => (
        <div className="max-w-64">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate font-medium"
              title={row.original.name ?? undefined}
            >
              {row.original.name ?? "—"}
            </span>
            {row.original.hidden ? (
              <StatusBadge color="grey" outline>
                oculta
              </StatusBadge>
            ) : null}
          </div>
          <div
            className="truncate text-xs text-muted-foreground"
            title={row.original.address ?? undefined}
          >
            {row.original.address ?? "—"}
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => row.status ?? "",
      filterFn: "equalsString",
      cell: ({ row }) => {
        const status = row.original.status;
        if (status === null) {
          return <StatusBadge color="grey" outline>—</StatusBadge>;
        }
        const ui = STATION_STATUS_UI[status];
        return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
      },
      meta: {
        csvValue: (row: EstacaoRow) =>
          row.status ? STATION_STATUS_UI[row.status].label : "",
      },
    },
    {
      id: "fontes",
      header: "Fontes",
      enableSorting: false,
      filterFn: fontesFilterFn,
      cell: ({ row }) => {
        const { sources } = row.original;
        const chip =
          "inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground";
        return (
          <div className="flex flex-wrap items-center gap-1">
            {sources.enel > 0 && (
              <span className={chip} title={`${sources.enel} instalação(ões) Enel`}>
                <Zap className="size-3" strokeWidth={2} />
                Enel{sources.enel > 1 ? ` ×${sources.enel}` : ""}
              </span>
            )}
            {sources.edp > 0 && (
              <span className={chip} title={`${sources.edp} instalação(ões) EDP`}>
                <Zap className="size-3" strokeWidth={2} />
                EDP{sources.edp > 1 ? ` ×${sources.edp}` : ""}
              </span>
            )}
            {sources.rent > 0 && (
              <span className={chip} title="Contrato de aluguel">
                <Home className="size-3" strokeWidth={2} />
                Aluguel
              </span>
            )}
            {sources.thirdParty > 0 && (
              <span
                className={chip}
                title={`${sources.thirdParty} conta(s) de terceiro (Hubees/DIA/KC/condomínio)`}
              >
                <Handshake className="size-3" strokeWidth={2} />
                Terceiro{sources.thirdParty > 1 ? ` ×${sources.thirdParty}` : ""}
              </span>
            )}
            {sources.enel + sources.edp + sources.rent + sources.thirdParty ===
              0 && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        );
      },
      meta: { csvValue: fontesCsv },
    },
    {
      id: "statusFatura",
      header: "Fatura energia",
      accessorFn: (row) => row.worstBillStatus ?? "",
      filterFn: "equalsString",
      cell: ({ row }) => {
        const status = row.original.worstBillStatus;
        if (status === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const ui = UTILITY_BILL_STATUS_UI[status];
        const detail = row.original.billStatusDetail.join("\n");
        const carried =
          row.original.hasCarriedForwardStatus &&
          "\nStatus pode estar defasado — carregado da última coleta.";
        return (
          <span title={`${detail}${carried || ""}`}>
            <StatusBadge color={ui.color}>
              {ui.label}
              {row.original.hasCarriedForwardStatus ? " *" : ""}
            </StatusBadge>
          </span>
        );
      },
      meta: {
        csvValue: (row: EstacaoRow) =>
          row.worstBillStatus
            ? UTILITY_BILL_STATUS_UI[row.worstBillStatus].label
            : "",
      },
    },
    {
      id: "vencimento",
      header: "Vencimento",
      accessorFn: (row) => row.earliestOpenDueDate ?? "",
      cell: ({ row }) => {
        const due = row.original.earliestOpenDueDate;
        if (!due) return <span className="text-xs text-muted-foreground">—</span>;
        const past = isPastDue(due, today);
        return (
          <span
            className={`tabular-nums ${past ? "font-semibold text-error" : ""}`}
            title={formatDate(due)}
          >
            {formatDate(due).slice(0, 5)}
          </span>
        );
      },
      meta: {
        csvValue: (row: EstacaoRow) => formatDate(row.earliestOpenDueDate),
      },
    },
    {
      id: "ultimaFatura",
      header: "Última fatura (R$)",
      accessorFn: (row) => row.lastBillingTotal ?? -Infinity,
      cell: ({ row }) => (
        <div className="text-right">
          <span className="tabular-nums">
            {formatBRL(row.original.lastBillingTotal)}
          </span>
        </div>
      ),
      meta: {
        csvValue: (row: EstacaoRow) => row.lastBillingTotal ?? "",
      },
    },
    {
      id: "debitoAutomatico",
      header: "Débito automático",
      accessorFn: (row) => row.autoDebitAggregate,
      filterFn: "equalsString",
      cell: ({ row }) => {
        const ui = AUTO_DEBIT_UI[row.original.autoDebitAggregate];
        return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
      },
      meta: {
        csvValue: (row: EstacaoRow) => AUTO_DEBIT_UI[row.autoDebitAggregate].label,
      },
    },
    {
      id: "aluguelMes",
      header: "Aluguel (mês)",
      accessorFn: (row) => row.rentStatusCurrentMonth ?? "",
      filterFn: aluguelFilterFn,
      cell: ({ row }) => {
        const status = row.original.rentStatusCurrentMonth;
        if (status === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const ui = CHARGE_STATUS_UI[status];
        return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
      },
      meta: {
        csvValue: (row: EstacaoRow) =>
          row.rentStatusCurrentMonth
            ? CHARGE_STATUS_UI[row.rentStatusCurrentMonth].label
            : "",
      },
    },
    {
      id: "contrato",
      header: "Contrato",
      accessorFn: (row) => row.contractType ?? "",
      cell: ({ row }) => {
        const { contractType, valorMensal, sources, status } = row.original;
        if (contractType !== null) {
          const ui = CONTRACT_TYPE_UI[contractType];
          return (
            <span className="inline-flex items-center gap-1.5">
              <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
              <span className="tabular-nums text-xs text-muted-foreground">
                {formatBRL(valorMensal)}
              </span>
            </span>
          );
        }
        if (sources.rent === 0 && status === "ACTIVE") {
          return (
            <StatusBadge color="red" outline>
              Sem contrato
            </StatusBadge>
          );
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      },
      meta: {
        csvValue: (row: EstacaoRow) =>
          row.contractType
            ? `${CONTRACT_TYPE_UI[row.contractType].label} ${row.valorMensal ?? ""}`.trim()
            : row.sources.rent === 0 && row.status === "ACTIVE"
              ? "Sem contrato"
              : "",
      },
    },
    {
      id: "ultimaColeta",
      header: "Última coleta",
      accessorFn: (row) => row.freshness ?? "",
      cell: ({ row }) => <FreshnessDot timestamp={row.original.freshness} />,
      meta: { csvValue: (row: EstacaoRow) => row.freshness ?? "" },
    },
    {
      id: "desligamento",
      header: "Desligamento",
      accessorFn: (row) => row.shutdownDate ?? "",
      cell: ({ row }) => {
        const { shutdownDate, shutdownWindow } = row.original;
        if (!shutdownDate) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span
            title={
              shutdownWindow
                ? `Desligamento programado Enel — janela ${shutdownWindow}`
                : "Desligamento programado Enel"
            }
          >
            <StatusBadge color="orange">
              <Zap className="size-3" strokeWidth={2} />
              {formatDate(shutdownDate).slice(0, 5)}
            </StatusBadge>
          </span>
        );
      },
      meta: {
        csvValue: (row: EstacaoRow) => formatDate(row.shutdownDate),
      },
    },
    // ── Hidden by default (column-visibility menu) ────────────────────────
    {
      id: "parceiro",
      header: "Parceiro",
      accessorFn: (row) => row.parceiro ?? "",
      cell: ({ row }) => (
        <div
          className="max-w-48 truncate text-xs"
          title={row.original.parceiro ?? undefined}
        >
          {row.original.parceiro ?? "—"}
        </div>
      ),
    },
    {
      id: "cadastroId",
      header: "Cadastro",
      accessorFn: (row) => row.cadastroId ?? "",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.cadastroId ?? "—"}</span>
      ),
    },
    {
      id: "boxes",
      header: "Boxes",
      accessorFn: (row) => row.boxCount ?? -Infinity,
      cell: ({ row }) => (
        <div className="text-right">
          <span className="tabular-nums">
            {row.original.boxCount ?? "—"}
          </span>
        </div>
      ),
      meta: { csvValue: (row: EstacaoRow) => row.boxCount ?? "" },
    },
    {
      id: "criadaEm",
      header: "Criada em",
      accessorFn: (row) => row.sourceCreatedAt ?? "",
      cell: ({ row }) => (
        <span className="tabular-nums text-xs">
          {formatDate(row.original.sourceCreatedAt)}
        </span>
      ),
      meta: { csvValue: (row: EstacaoRow) => formatDate(row.sourceCreatedAt) },
    },
    {
      id: "latLong",
      header: "Lat/Long",
      enableSorting: false,
      accessorFn: (row) =>
        row.latitude !== null && row.longitude !== null
          ? `${row.latitude}, ${row.longitude}`
          : "",
      cell: ({ row }) => {
        const { latitude, longitude } = row.original;
        if (latitude === null || longitude === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="tabular-nums text-xs">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </span>
        );
      },
    },
    {
      // No `header` → stays out of the "Colunas" menu (enableHiding: false) AND
      // the CSV export (which only emits columns with a defined header).
      id: "acoes",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const hidden = row.original.hidden;
        return (
          <div className="text-right">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={hidden ? "Mostrar estação" : "Ocultar estação"}
              title={
                hidden
                  ? "Mostrar esta estação na lista"
                  : "Ocultar esta estação da lista"
              }
              onClick={(e) => {
                e.stopPropagation();
                onToggleHidden(row.original);
              }}
            >
              {hidden ? (
                <Eye className="size-4" strokeWidth={2} />
              ) : (
                <EyeOff className="size-4" strokeWidth={2} />
              )}
            </Button>
          </div>
        );
      },
    },
  ];
}
