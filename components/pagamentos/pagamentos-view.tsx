"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuditByline } from "@/components/vammo/audit-byline";
import { ComprovanteChip } from "@/components/vammo/comprovante-chip";
import { DataTable } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { StatCard } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  CHARGE_KIND_UI,
  CHARGE_STATUS_UI,
  MATCH_STATUS_UI,
  PAYMENT_METHOD_LABEL,
} from "@/lib/labels";
import { formatBRL, formatCompetencia } from "@/lib/format";
import type { ChargeStatus, IngestSource } from "@/lib/domain";
import { cn } from "@/lib/utils";

import type { PagamentoRow } from "./types";
import { GerarMesDialog } from "./gerar-mes-dialog";
import { StatusActions } from "./status-actions";
import { FlagBadges } from "./flag-badges";

/**
 * Ingest source → pt-BR badge label (labels.ts has no ingest-source map yet;
 * Phase 1 rows are all 'sheet_backfill' = planilha).
 */
const SOURCE_LABEL: Record<IngestSource, string> = {
  sheet_backfill: "planilha",
  scraper_enel: "scraper Enel",
  scraper_edp: "scraper EDP",
  email_ai: "e-mail",
  drive_poll: "Drive",
  manual: "manual",
  metabase_sync: "Metabase",
  gerar_mes: "Gerado",
  auto_match: "conciliação",
  app_upload: "upload",
};

const PAID_STATUSES: ChargeStatus[] = ["pago", "antecipado"];

/** Typed CSV-override meta (DataTable reads `meta.csvValue`). */
function csvMeta(
  csvValue: (row: PagamentoRow) => unknown,
): ColumnDef<PagamentoRow, unknown>["meta"] {
  return { csvValue } as ColumnDef<PagamentoRow, unknown>["meta"];
}

function hasMismatch(row: PagamentoRow): boolean {
  return (
    row.amount !== null &&
    row.expectedAmount !== null &&
    Math.abs(row.amount - row.expectedAmount) > 0.01
  );
}

const baseColumns: ColumnDef<PagamentoRow, unknown>[] = [
  {
    id: "estacao",
    header: "Estação",
    // Unmatched (UNIDENTIFIED) rows sort to the top of the station grouping.
    accessorFn: (r) => r.stationId ?? -1,
    cell: ({ row }) => {
      const { stationId, stationName, matchStatus } = row.original;
      if (stationId === null) {
        const ui = MATCH_STATUS_UI[matchStatus];
        return (
          <Link href="/revisao" title="Abrir fila de revisão">
            <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          </Link>
        );
      }
      return (
        <Link
          href={`/estacoes/${stationId}`}
          className="block underline-offset-2 hover:underline"
        >
          <span className="font-medium tabular-nums">#{stationId}</span>
          {stationName ? (
            <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
              {stationName}
            </span>
          ) : null}
        </Link>
      );
    },
    meta: csvMeta((r) =>
      r.stationId !== null
        ? `${r.stationId} ${r.stationName ?? ""}`.trim()
        : `(${r.matchStatus})`,
    ),
  },
  {
    id: "competencia",
    header: "Competência",
    accessorFn: (r) => r.competencia ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCompetencia(row.original.competencia)}
      </span>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    accessorFn: (r) => CHARGE_KIND_UI[r.kind].label,
    cell: ({ row }) => {
      const ui = CHARGE_KIND_UI[row.original.kind];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "parceiro",
    header: "Parceiro",
    accessorFn: (r) => r.parceiro ?? "",
    cell: ({ row }) => (
      <span
        className="block max-w-[220px] truncate"
        title={row.original.parceiro ?? undefined}
      >
        {row.original.parceiro ?? "—"}
      </span>
    ),
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (r) => r.amount ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => {
      const mismatch = hasMismatch(row.original);
      return (
        <span
          className={cn(
            "block rounded px-1 text-right font-medium tabular-nums",
            mismatch && "bg-error-subtle text-error-emphasis",
          )}
          title={
            mismatch
              ? `Difere do previsto: ${formatBRL(row.original.expectedAmount)}`
              : undefined
          }
        >
          {formatBRL(row.original.amount)}
        </span>
      );
    },
    meta: csvMeta((r) => r.amount ?? ""),
  },
  {
    id: "previsto",
    header: "Previsto",
    accessorFn: (r) => r.expectedAmount ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-muted-foreground">
        {formatBRL(row.original.expectedAmount)}
      </span>
    ),
    meta: csvMeta((r) => r.expectedAmount ?? ""),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => CHARGE_STATUS_UI[r.status].label,
    cell: ({ row }) => {
      const r = row.original;
      const ui = CHARGE_STATUS_UI[r.status];
      // A linked comprovante is paid: auto-matches land on 'pago' (→ green
      // "Pago"). 'conciliado' is now a legacy state — render it with the one
      // canonical badge; its confirm action still lives in StatusActions.
      return (
        <div className="space-y-0.5">
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          {r.statusSource === "rpc" && r.lastActorAt ? (
            <AuditByline
              actorEmail={r.lastActorEmail}
              at={r.lastActorAt}
              className="block"
            />
          ) : null}
        </div>
      );
    },
  },
  {
    id: "flags",
    header: "Sinalizações",
    enableSorting: false,
    accessorFn: (r) => r.flags.join(" "),
    cell: ({ row }) => <FlagBadges flags={row.original.flags} />,
    meta: csvMeta((r) => r.flags.join(", ")),
  },
  {
    id: "pagamento",
    header: "Pagamento",
    accessorFn: (r) =>
      r.paymentMethod ? PAYMENT_METHOD_LABEL[r.paymentMethod] : "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.paymentMethod
          ? PAYMENT_METHOD_LABEL[row.original.paymentMethod]
          : "—"}
      </span>
    ),
  },
  {
    id: "comprovante",
    header: "Comprovante",
    accessorFn: (r) => (r.payment ? "Vinculado" : ""),
    cell: ({ row }) =>
      row.original.payment ? (
        <ComprovanteChip summary={row.original.payment} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: csvMeta((r) => (r.payment ? "vinculado" : "")),
  },
  {
    id: "notaFiscal",
    header: "No Fiscal",
    accessorFn: (r) => r.notaFiscal ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.notaFiscal ?? "—"}
      </span>
    ),
  },
  {
    id: "origem",
    header: "Origem",
    accessorFn: (r) => SOURCE_LABEL[r.source],
    cell: ({ row }) => (
      <StatusBadge color="grey" outline>
        {SOURCE_LABEL[row.original.source]}
      </StatusBadge>
    ),
  },
  {
    id: "observacoes",
    header: "Observações",
    accessorFn: (r) => r.notes ?? "",
    cell: ({ row }) => (
      <span
        className="block max-w-[240px] truncate text-muted-foreground"
        title={row.original.notes ?? undefined}
      >
        {row.original.notes ?? "—"}
      </span>
    ),
  },
  {
    id: "dedupe",
    header: "Chave dedupe",
    accessorFn: (r) => r.dedupeKey,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {row.original.dedupeKey}
      </span>
    ),
  },
];

export function PagamentosView({
  rows,
  canWrite,
  isAdmin,
}: {
  rows: PagamentoRow[];
  /** operator or admin — enables Gerar mês + lifecycle actions. */
  canWrite: boolean;
  /** admin — additionally enables the "Cancelada" transition. */
  isAdmin: boolean;
}) {
  const months = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.competencia) set.add(r.competencia.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [rows]);
  const hasNoCompetencia = React.useMemo(
    () => rows.some((r) => r.competencia === null),
    [rows],
  );

  const [month, setMonth] = React.useState<string>(months[0] ?? "all");

  const filtered = React.useMemo(() => {
    if (month === "all") return rows;
    if (month === "none") return rows.filter((r) => r.competencia === null);
    return rows.filter((r) => r.competencia?.slice(0, 7) === month);
  }, [rows, month]);

  const summary = React.useMemo(() => {
    let previstoSum = 0;
    let pagoCount = 0;
    let pagoSum = 0;
    let pendenteCount = 0;
    let pendenteSum = 0;
    for (const r of filtered) {
      previstoSum += r.amount ?? r.expectedAmount ?? 0;
      if (PAID_STATUSES.includes(r.status)) {
        pagoCount += 1;
        pagoSum += r.amount ?? 0;
      } else if (r.status !== "cancelada" && r.status !== "nao_aplicavel") {
        pendenteCount += 1;
        pendenteSum += r.amount ?? r.expectedAmount ?? 0;
      }
    }
    return { previstoSum, pagoCount, pagoSum, pendenteCount, pendenteSum };
  }, [filtered]);

  const columns = React.useMemo<ColumnDef<PagamentoRow, unknown>[]>(
    () => [
      ...baseColumns,
      {
        id: "acoes",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <StatusActions
            row={row.original}
            canWrite={canWrite}
            isAdmin={isAdmin}
          />
        ),
      },
    ],
    [canWrite, isAdmin],
  );

  const monthLabel =
    month === "all"
      ? "Todos os meses"
      : month === "none"
        ? "Sem competência"
        : formatCompetencia(`${month}-01`);

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Ledger mensal de cobranças por estação — aluguel e energia"
        actions={
          <>
            <Select value={month} onValueChange={(v) => setMonth(v as string)}>
              <SelectTrigger className="bg-card">
                <SelectValue>{monthLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatCompetencia(`${m}-01`)}
                  </SelectItem>
                ))}
                {hasNoCompetencia ? (
                  <SelectItem value="none">Sem competência</SelectItem>
                ) : null}
                <SelectItem value="all">Todos os meses</SelectItem>
              </SelectContent>
            </Select>
            <GerarMesDialog canWrite={canWrite} />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={`Total previsto (${monthLabel})`}
          value={formatBRL(summary.previstoSum)}
          sub={`${filtered.length} cobranças`}
        />
        <StatCard
          label="Pago"
          value={formatBRL(summary.pagoSum)}
          sub={`${summary.pagoCount} de ${filtered.length} cobranças`}
          tone="success"
        />
        <StatCard
          label="Pendente"
          value={formatBRL(summary.pendenteSum)}
          sub={`${summary.pendenteCount} de ${filtered.length} cobranças`}
          tone={summary.pendenteCount > 0 ? "warning" : "default"}
        />
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Buscar estação, parceiro…"
        csvFilename="pagamentos"
        initialSorting={[{ id: "estacao", desc: false }]}
        initialColumnVisibility={{ dedupe: false }}
        emptyMessage="Nenhuma cobrança encontrada para o período."
      />
    </>
  );
}
