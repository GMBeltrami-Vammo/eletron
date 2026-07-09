"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import type { NormalizationIssue } from "@/lib/domain";

/**
 * pt-BR labels for NormalizationIssue codes. These are ingest diagnostics, not
 * domain enums — lib/labels.ts stays the single source for status→color;
 * issues render as neutral grey badges only.
 */
const ISSUE_CODE_LABEL: Record<NormalizationIssue["code"], string> = {
  invalid_station_id: "ID de estação inválido",
  invalid_cadastro_id: "ID de cadastro inválido",
  unknown_bill_status: "Status de fatura desconhecido",
  unknown_auto_debit: "Débito automático desconhecido",
  unknown_enum_literal: "Valor de enum desconhecido",
  unparseable_money: "Valor monetário ilegível",
  unparseable_date: "Data ilegível",
  unparseable_competencia: "Competência ilegível",
  duplicate_dedupe_key: "Chave duplicada",
  missing_key: "Chave ausente",
  missing_account: "Conta ausente",
  zip_length_mismatch: "CEP com tamanho inválido",
  invalid_value: "Valor inválido",
};

const columns: ColumnDef<NormalizationIssue, unknown>[] = [
  {
    id: "kind",
    header: "Tipo",
    accessorFn: (issue) => ISSUE_CODE_LABEL[issue.code] ?? issue.code,
    cell: ({ row }) => (
      <StatusBadge color="grey" outline>
        {ISSUE_CODE_LABEL[row.original.code] ?? row.original.code}
      </StatusBadge>
    ),
  },
  {
    id: "tab",
    header: "Aba",
    accessorFn: (issue) => `${issue.tab} linha ${issue.rowNumber}`,
    cell: ({ row }) => {
      const issue = row.original;
      return (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{issue.tab}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            linha {issue.rowNumber}
            {issue.column ? ` · ${issue.column}` : ""}
          </span>
        </div>
      );
    },
  },
  {
    id: "detail",
    header: "Detalhe",
    accessorFn: (issue) => issue.message,
    cell: ({ row }) => {
      const issue = row.original;
      return (
        <div className="flex max-w-md flex-col gap-0.5">
          <span className="truncate" title={issue.message}>
            {issue.message}
          </span>
          {issue.rawValue ? (
            <span
              className="truncate text-xs text-muted-foreground"
              title={issue.rawValue}
            >
              valor bruto: {issue.rawValue}
            </span>
          ) : null}
        </div>
      );
    },
    meta: {
      csvValue: (issue: NormalizationIssue) =>
        issue.rawValue
          ? `${issue.message} (valor bruto: ${issue.rawValue})`
          : issue.message,
    },
  },
];

/** Issues count + collapsible list (first 50) for the admin ingestion card. */
export function IngestIssues({
  issues,
  total,
}: {
  issues: NormalizationIssue[];
  total: number;
}) {
  const [open, setOpen] = React.useState(false);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum problema de normalização no último snapshot.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert
          className="size-4 text-warning-emphasis"
          strokeWidth={2}
        />
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{total}</span>{" "}
          {total === 1
            ? "problema de normalização"
            : "problemas de normalização"}{" "}
          no snapshot
        </span>
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Ocultar lista" : "Ver lista"}
          {open ? (
            <ChevronUp className="size-4" strokeWidth={2} />
          ) : (
            <ChevronDown className="size-4" strokeWidth={2} />
          )}
        </Button>
      </div>
      {open ? (
        <div className="space-y-2">
          {total > issues.length ? (
            <p className="text-xs text-muted-foreground">
              Mostrando os primeiros{" "}
              <span className="tabular-nums">{issues.length}</span> de{" "}
              <span className="tabular-nums">{total}</span> problemas.
            </p>
          ) : null}
          <DataTable
            columns={columns}
            data={issues}
            searchPlaceholder="Buscar problema…"
            csvFilename="problemas-normalizacao"
            pageSize={10}
            filterableColumnIds="all"
            emptyMessage="Nenhum problema encontrado."
          />
        </div>
      ) : null}
    </div>
  );
}
