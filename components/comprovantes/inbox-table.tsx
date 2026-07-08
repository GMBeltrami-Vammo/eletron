"use client";

/**
 * Comprovantes inbox (client): upload card + KPI strip + documents table.
 * Owns the inbox query seeded with the server's initial data and polls every
 * 5 s while any document is still processing (`pending`). One row per
 * `charging.documents` row of kind `comprovante`.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuditByline } from "@/components/vammo/audit-byline";
import { DataTable } from "@/components/vammo/data-table";
import { StatCard } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatNumber } from "@/lib/format";

import { fetchInboxData } from "./actions";
import {
  PROCESSING_STATUS_UI,
  origemLabel,
} from "./labels";
import type { InboxData, InboxDocRow, ViewerContext } from "./types";
import { UploadCard } from "./upload-card";
import { NOT_OPERATOR } from "./write-helpers";

const INBOX_KEY = ["comprovantes-inbox"] as const;

function buildColumns(
  isOperator: boolean,
): ColumnDef<InboxDocRow, unknown>[] {
  return [
    {
      id: "documento",
      header: "Documento",
      accessorFn: (r) => r.filename ?? r.id,
      cell: ({ row }) => (
        <span
          className="block max-w-[280px] truncate font-medium"
          title={row.original.filename ?? undefined}
        >
          {row.original.filename ?? "(sem nome)"}
        </span>
      ),
    },
    {
      id: "enviado",
      header: "Enviado por / em",
      accessorFn: (r) => r.uploadedByEmail ?? "",
      cell: ({ row }) => (
        <AuditByline
          actorEmail={row.original.uploadedByEmail}
          at={row.original.createdAt}
        />
      ),
    },
    {
      id: "paginas",
      header: "Páginas",
      accessorFn: (r) => r.pageCount ?? 0,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-muted-foreground">
          {row.original.pageCount ?? "—"}
        </span>
      ),
    },
    {
      id: "recibos",
      header: "Recibos",
      accessorFn: (r) => r.receiptCount,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {row.original.receiptCount}
        </span>
      ),
    },
    {
      id: "conciliacao",
      header: "Conciliação",
      enableSorting: false,
      cell: ({ row }) => {
        const { conciliados, ambiguos, semCorresp } = row.original;
        return (
          <span
            className="inline-flex items-center gap-2 text-xs tabular-nums"
            title="conciliados · ambíguos · sem correspondência"
          >
            <span className="text-success-emphasis">{conciliados}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-warning-emphasis">{ambiguos}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-error">{semCorresp}</span>
          </span>
        );
      },
    },
    {
      id: "processamento",
      header: "Processamento",
      accessorFn: (r) => PROCESSING_STATUS_UI[r.processingStatus].label,
      cell: ({ row }) => {
        const ui = PROCESSING_STATUS_UI[row.original.processingStatus];
        const failed = row.original.processingStatus === "failed";
        return (
          <span className="inline-flex items-center gap-2">
            <span title={row.original.processingError ?? undefined}>
              <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
            </span>
            {failed ? (
              <span
                title={
                  isOperator
                    ? "Reprocessamento manual chega na fase 3 (o cron reprocessa a fila)"
                    : NOT_OPERATOR
                }
                className="inline-flex cursor-not-allowed"
                onClick={(e) => e.stopPropagation()}
              >
                <Button size="xs" variant="outline" disabled>
                  <RefreshCw className="size-3" strokeWidth={2} />
                  Reprocessar
                </Button>
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "origem",
      header: "Origem",
      accessorFn: (r) => origemLabel(r.source),
      cell: ({ row }) => (
        <StatusBadge color="grey" outline>
          {origemLabel(row.original.source)}
        </StatusBadge>
      ),
    },
  ];
}

function hasPending(data: InboxData | undefined): boolean {
  return Boolean(data?.rows.some((r) => r.processingStatus === "pending"));
}

export function ComprovantesInbox({
  initialData,
  viewer,
}: {
  initialData: InboxData;
  viewer: ViewerContext;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data = initialData } = useQuery({
    queryKey: INBOX_KEY,
    queryFn: fetchInboxData,
    initialData,
    refetchInterval: (query) =>
      hasPending(query.state.data) ? 5_000 : false,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: INBOX_KEY });
  }, [queryClient]);

  const columns = React.useMemo(
    () => buildColumns(viewer.isOperator),
    [viewer.isOperator],
  );

  const { kpis } = data;

  return (
    <div className="space-y-4">
      <UploadCard isOperator={viewer.isOperator} onUploaded={invalidate} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Enviados este mês" value={formatNumber(kpis.enviadosMes)} />
        <StatCard
          label="Recibos extraídos"
          value={formatNumber(kpis.recibosExtraidos)}
        />
        <StatCard
          label="Conciliados (confirmados)"
          value={formatNumber(kpis.conciliadosConfirmados)}
          tone="success"
        />
        <StatCard
          label="Aguardando revisão"
          value={formatNumber(kpis.aguardandoRevisao)}
          tone={kpis.aguardandoRevisao > 0 ? "warning" : "default"}
          href="/revisao/comprovantes"
        />
      </div>

      {!data.available ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Sem conexão com o banco (Supabase). A lista aparece quando o backend
          de comprovantes estiver configurado.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={data.rows}
        searchPlaceholder="Buscar documento, remetente…"
        csvFilename="comprovantes"
        onRowClick={(row) => router.push(`/comprovantes/${row.id}`)}
        emptyMessage="Nenhum comprovante enviado ainda."
      />
    </div>
  );
}
