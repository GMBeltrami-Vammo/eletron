"use client";

/**
 * Email-classification review queue (R2, requirement 4): lists every
 * `needs_review` charge the n8n webhook (or a clone-era UNIDENTIFIED row) left
 * for a human, with a PDF-proxy link and a reclassify dialog. "Aprovar como
 * está" accepts the classification; "Revisar" opens the full editor. Both call
 * the `reclassify_charge` RPC through the server actions.
 */

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { ChargeEditorDialog } from "@/components/cobrancas/charge-editor-dialog";
import { approveCobranca } from "@/app/actions/cobrancas";
import { CHARGE_KIND_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia } from "@/lib/format";

import type {
  CadastroOption,
  MergeTargetRow,
  ReviewChargeRow,
  StationOption,
} from "@/app/(app)/revisao/cobrancas/queries";
import { buildUnifyProposals } from "./unify-proposals";
import { UnifyProposalsPanel } from "./unify-proposals-panel";

export function CobrancasReview({
  rows,
  stations,
  cadastros,
  mergeTargets,
  available,
}: {
  rows: ReviewChargeRow[];
  stations: StationOption[];
  cadastros: CadastroOption[];
  mergeTargets: MergeTargetRow[];
  available: boolean;
}) {
  const [editing, setEditing] = React.useState<ReviewChargeRow | null>(null);
  const { run, pending } = useRunAction();
  const proposals = React.useMemo(
    () => buildUnifyProposals(rows, mergeTargets),
    [rows, mergeTargets],
  );

  const columns = React.useMemo<ColumnDef<ReviewChargeRow, unknown>[]>(
    () => [
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
        id: "alvo",
        header: "Estação / parceiro",
        accessorFn: (r) => r.stationName ?? r.parceiro ?? "",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="text-sm">
              {r.stationId !== null ? (
                <span className="font-medium">
                  #{r.stationId} {r.stationName ?? ""}
                </span>
              ) : r.parceiro ? (
                r.parceiro
              ) : (
                <span className="text-muted-foreground">sem atribuição</span>
              )}
              {r.cadastroId !== null ? (
                <span className="block text-xs text-muted-foreground">
                  cadastro {r.cadastroId}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "valor",
        header: "Valor",
        accessorFn: (r) => r.amount ?? Number.MIN_SAFE_INTEGER,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="block text-right tabular-nums">
              <span className="font-medium">{formatBRL(r.amount)}</span>
              {r.expectedAmount !== null && r.expectedAmount !== r.amount ? (
                <span className="block text-xs text-muted-foreground">
                  previsto {formatBRL(r.expectedAmount)}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "pdf",
        header: "PDF",
        enableSorting: false,
        accessorFn: (r) => (r.documentId ? "sim" : ""),
        cell: ({ row }) =>
          row.original.documentId ? (
            <a
              href={`/api/files/${row.original.documentId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-info-emphasis underline-offset-2 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Ver PDF
              <ExternalLink className="size-3.5" strokeWidth={2} />
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "acoes",
        header: "Ações",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !available}
                onClick={() =>
                  run(() => approveCobranca(r.id, r.kind), {
                    success: "Classificação aprovada",
                  })
                }
              >
                Aprovar
              </Button>
              <Button
                size="sm"
                disabled={!available}
                onClick={() => setEditing(r)}
              >
                <PencilLine className="size-4" strokeWidth={2} />
                Revisar
              </Button>
            </div>
          );
        },
      },
    ],
    [run, pending, available],
  );

  return (
    <>
      <UnifyProposalsPanel proposals={proposals} available={available} />
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Buscar cobrança, parceiro, estação…"
        csvFilename="cobrancas-revisao"
        initialSorting={[{ id: "competencia", desc: true }]}
        filterableColumnIds="all"
        emptyMessage={
          available
            ? "Nenhuma cobrança aguardando revisão."
            : "Fila indisponível — backend Supabase não configurado."
        }
      />
      {editing ? (
        <ChargeEditorDialog
          row={editing}
          stations={stations}
          cadastros={cadastros}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
