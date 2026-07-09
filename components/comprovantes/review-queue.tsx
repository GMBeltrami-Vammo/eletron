"use client";

/**
 * Comprovantes review queue (client): receipts with `match_status` in
 * (unmatched, needs_review). Each row shows the parsed fields, any candidate
 * charges the matcher ranked (in `match_notes`), and the actions: Conciliar
 * (opens the shared charge picker → record_payment) or "não é comprovante"
 * (deferred — needs a receipt-reject RPC, see report).
 */

import * as React from "react";
import Link from "next/link";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatCnpjCpf } from "@/components/revisao/labels";
import { rejectReceipt } from "@/app/actions/comprovantes";
import { CHARGE_KIND_UI, MATCH_STATUS_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

import { fetchReviewData } from "./actions";
import { ChargePicker } from "./charge-picker";
import { RECEIPT_TYPE_UI } from "./labels";
import type {
  ReviewCandidate,
  ReviewData,
  ReviewReceiptRow,
  ViewerContext,
} from "./types";
import { Gate, useRunAction } from "./write-helpers";

const REVIEW_KEY = ["comprovantes-review"] as const;

interface PickerTarget {
  row: ReviewReceiptRow;
  preselect: string | null;
}

/**
 * Operator-gated "Não é comprovante": prompts for an optional reason (Cancel
 * aborts) then calls `rejectReceipt`, which drops the receipt out of the review
 * queue. Toast + query invalidation come from `useRunAction`.
 */
function RejectButton({
  receiptId,
  isOperator,
  invalidate,
}: {
  receiptId: string;
  isOperator: boolean;
  invalidate: QueryKey[];
}) {
  const { run, pending } = useRunAction();
  function onReject() {
    const reason = window.prompt(
      "Marcar como “não é comprovante”. Descreva o motivo (opcional):",
      "",
    );
    if (reason === null) return; // cancelado
    void run(() => rejectReceipt(receiptId, reason), {
      success: "Recibo removido da fila (não é comprovante)",
      invalidate,
    });
  }
  return (
    <Gate isOperator={isOperator}>
      <Button
        size="xs"
        variant="ghost"
        disabled={!isOperator || pending}
        onClick={onReject}
      >
        <Ban className="size-3" strokeWidth={2} />
        Não é comprovante
      </Button>
    </Gate>
  );
}

export function ReviewQueue({
  initialData,
  viewer,
}: {
  initialData: ReviewData;
  viewer: ViewerContext;
}) {
  const [target, setTarget] = React.useState<PickerTarget | null>(null);

  const { data = initialData } = useQuery({
    queryKey: REVIEW_KEY,
    queryFn: fetchReviewData,
    initialData,
  });

  const columns = React.useMemo<ColumnDef<ReviewReceiptRow, unknown>[]>(() => {
    const openPicker = (row: ReviewReceiptRow, preselect: string | null) =>
      setTarget({ row, preselect });

    return [
      {
        id: "documento",
        header: "Documento",
        accessorFn: (r) => r.filename ?? r.documentId,
        cell: ({ row }) => (
          <Link
            href={`/comprovantes/${row.original.documentId}`}
            className="block max-w-[220px] underline-offset-2 hover:underline"
            title={row.original.filename ?? undefined}
          >
            <span className="block truncate font-medium">
              {row.original.filename ?? "(sem nome)"}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              página {row.original.pageNumber}
              {row.original.segmentIndex > 0
                ? ` · seg ${row.original.segmentIndex}`
                : ""}
            </span>
          </Link>
        ),
      },
      {
        id: "tipo",
        header: "Tipo",
        accessorFn: (r) => RECEIPT_TYPE_UI[r.receiptType].label,
        cell: ({ row }) => {
          const ui = RECEIPT_TYPE_UI[row.original.receiptType];
          return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
        },
      },
      {
        id: "valor",
        header: "Valor",
        accessorFn: (r) => r.amount ?? "",
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatBRL(row.original.amount)}
          </span>
        ),
        meta: { csvValue: (r: ReviewReceiptRow) => r.amount },
      },
      {
        id: "data",
        header: "Data",
        accessorFn: (r) => r.paidAt ?? "",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatDate(row.original.paidAt)}</span>
        ),
      },
      {
        id: "chave",
        header: "Chave / CNPJ",
        accessorFn: (r) => r.chavePix ?? r.cnpjCpf ?? "",
        cell: ({ row }) => {
          const { chavePix, cnpjCpf } = row.original;
          const text = chavePix ?? (cnpjCpf ? formatCnpjCpf(cnpjCpf) : null);
          return (
            <span
              className="block max-w-[200px] truncate font-mono text-xs"
              title={text ?? undefined}
            >
              {text ?? "—"}
            </span>
          );
        },
      },
      {
        id: "identificacao",
        header: "Identificação",
        accessorFn: (r) => r.identificacao ?? "",
        cell: ({ row }) => (
          <span
            className="block max-w-[200px] truncate text-xs text-muted-foreground"
            title={row.original.identificacao ?? undefined}
          >
            {row.original.identificacao ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => MATCH_STATUS_UI[r.matchStatus].label,
        cell: ({ row }) => {
          const ui = MATCH_STATUS_UI[row.original.matchStatus];
          return (
            <span title={row.original.matchNotes ?? undefined}>
              <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
            </span>
          );
        },
      },
      {
        id: "candidatos",
        header: "Candidatos",
        enableSorting: false,
        cell: ({ row }) => {
          const candidates = row.original.candidates;
          if (candidates.length === 0) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {candidates.map((c: ReviewCandidate) => (
                <Gate key={c.id} isOperator={viewer.isOperator}>
                  <button
                    type="button"
                    disabled={!viewer.isOperator}
                    onClick={() => openPicker(row.original, c.id)}
                    title="Conciliar com este candidato"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
                  >
                    <StatusBadge color={CHARGE_KIND_UI[c.kind].color}>
                      {CHARGE_KIND_UI[c.kind].label}
                    </StatusBadge>
                    {c.stationId !== null ? (
                      <span className="tabular-nums">#{c.stationId}</span>
                    ) : null}
                    <span className="tabular-nums text-muted-foreground">
                      {formatCompetencia(c.competencia)}
                    </span>
                    <span className="tabular-nums">{formatBRL(c.amount)}</span>
                  </button>
                </Gate>
              ))}
            </div>
          );
        },
      },
      {
        id: "acoes",
        header: "Ações",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Gate isOperator={viewer.isOperator}>
              <Button
                size="xs"
                variant="outline"
                disabled={!viewer.isOperator}
                onClick={() => openPicker(row.original, null)}
              >
                <Link2 className="size-3" strokeWidth={2} />
                Conciliar
              </Button>
            </Gate>
            <RejectButton
              receiptId={row.original.id}
              isOperator={viewer.isOperator}
              invalidate={[REVIEW_KEY, ["comprovantes-inbox"]]}
            />
          </div>
        ),
      },
    ];
  }, [viewer.isOperator]);

  return (
    <div className="space-y-4">
      {!data.available ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Sem conexão com o banco (Supabase). A fila aparece quando o backend de
          comprovantes estiver configurado.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={data.rows}
        searchPlaceholder="Buscar documento, chave, identificação…"
        csvFilename="comprovantes-revisao"
        filterableColumnIds="all"
        emptyMessage="Nenhum comprovante aguardando revisão."
      />

      {target ? (
        <ChargePicker
          open
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          receipt={{
            id: target.row.id,
            receiptType: target.row.receiptType,
            remaining: target.row.amount,
            paidAt: target.row.paidAt,
          }}
          isOperator={viewer.isOperator}
          invalidate={[REVIEW_KEY, ["comprovantes-inbox"]]}
          preselectChargeId={target.preselect}
        />
      ) : null}
    </div>
  );
}
