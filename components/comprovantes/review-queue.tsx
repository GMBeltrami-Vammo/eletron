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
import { Ban, ChevronDown, ChevronRight, Layers, Link2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatCnpjCpf } from "@/components/revisao/labels";
import { rejectReceipt, rejectReceipts } from "@/app/actions/comprovantes";
import { resolveReceiptGroup } from "@/app/actions/charges";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Gate, useRunAction } from "./write-helpers";
import { paymentMethodForReceipt } from "./payment-method";
import { buildResolvableGroups, type ResolvableGroup } from "./resolve-groups";
import { recordPayment } from "@/app/actions/charges";

const REVIEW_KEY = ["comprovantes-review"] as const;

interface PickerTarget {
  row: ReviewReceiptRow;
  preselect: string | null;
}

interface ConfirmTarget {
  row: ReviewReceiptRow;
  candidate: ReviewCandidate;
}

/**
 * One-click candidate confirmation: clicking a candidate chip opens this
 * lightweight recibo × cobrança summary; confirming records the payment
 * directly (same record_payment call the full picker makes) — no search, no
 * amount typing. Only offered when the receipt has a parsed amount; otherwise
 * the chip falls back to the full ChargePicker.
 */
function ConfirmBindDialog({
  target,
  onOpenChange,
  isOperator,
  invalidate,
}: {
  target: ConfirmTarget | null;
  onOpenChange: (open: boolean) => void;
  isOperator: boolean;
  invalidate: QueryKey[];
}) {
  const { run, pending } = useRunAction();
  if (!target) return null;
  const { row, candidate } = target;
  const typeUi = RECEIPT_TYPE_UI[row.receiptType];

  async function confirm() {
    if (row.amount === null) return;
    const ok = await run(
      () =>
        recordPayment({
          chargeId: candidate.id,
          receiptId: row.id,
          amount: row.amount as number,
          paidAt: row.paidAt,
          method: paymentMethodForReceipt(row.receiptType),
        }),
      { success: "Comprovante conciliado", invalidate },
    );
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar conciliação</DialogTitle>
          <DialogDescription>
            O recibo será vinculado a esta cobrança, que é marcada como paga
            quando o valor a cobre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recibo
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge color={typeUi.color}>{typeUi.label}</StatusBadge>
              <span className="tabular-nums">página {row.pageNumber}</span>
              <span className="font-medium tabular-nums">{formatBRL(row.amount)}</span>
              {row.paidAt ? (
                <span className="tabular-nums text-muted-foreground">
                  {formatDate(row.paidAt)}
                </span>
              ) : null}
              {row.chavePix ?? row.cnpjCpf ? (
                <span
                  className="max-w-[180px] truncate font-mono text-xs text-muted-foreground"
                  title={row.chavePix ?? row.cnpjCpf ?? undefined}
                >
                  {row.chavePix ?? formatCnpjCpf(row.cnpjCpf ?? "")}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cobrança
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge color={CHARGE_KIND_UI[candidate.kind].color}>
                {CHARGE_KIND_UI[candidate.kind].label}
              </StatusBadge>
              {candidate.stationId !== null ? (
                <span className="font-medium tabular-nums">
                  #{candidate.stationId}
                  {candidate.stationName ? ` — ${candidate.stationName}` : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">Sem estação</span>
              )}
              <span className="tabular-nums text-muted-foreground">
                {formatCompetencia(candidate.competencia)}
              </span>
              <span className="font-medium tabular-nums">
                {formatBRL(candidate.amount)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Gate isOperator={isOperator}>
            <Button onClick={() => void confirm()} disabled={!isOperator || pending}>
              <Link2 className="size-4" strokeWidth={2} />
              Conciliar
            </Button>
          </Gate>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Grupos resolvíveis" — the N↔N one-click resolver. Shown above the ambiguous
 * table so the operator can clear whole landlord groups (a payment per station,
 * all the same value) at once instead of picking each receipt by hand.
 */
function ResolvableGroups({
  groups,
  isOperator,
  invalidate,
}: {
  groups: ResolvableGroup[];
  isOperator: boolean;
  invalidate: QueryKey[];
}) {
  const { run, pending } = useRunAction();
  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Layers className="size-4 text-muted-foreground" strokeWidth={2} />
        <span className="text-sm font-medium">Grupos resolvíveis (N↔N)</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {groups.length}
        </span>
        <span className="text-xs text-muted-foreground">
          mesmo valor/chave, um pagamento por cobrança — confirme para casar de uma vez
        </span>
      </div>
      <ul className="divide-y divide-border">
        {groups.map((g) => {
          const n = g.receipts.length;
          const value = g.receipts[0].amount;
          return (
            <li
              key={g.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="font-medium tabular-nums">
                {n} recibo(s) ↔ {n} cobrança(s)
              </span>
              <span className="tabular-nums">{formatBRL(value)}</span>
              <span className="flex flex-wrap gap-1">
                {g.candidates.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]"
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
                  </span>
                ))}
              </span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                p{g.receipts.map((r) => r.pageNumber).join(", p")}
              </span>
              <Gate isOperator={isOperator}>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!isOperator || pending}
                  onClick={() =>
                    void run(() => resolveReceiptGroup(g.pairs), {
                      success: `Grupo casado (${n}↔${n})`,
                      invalidate,
                    })
                  }
                >
                  <Layers className="size-3" strokeWidth={2} />
                  Resolver grupo
                </Button>
              </Gate>
            </li>
          );
        })}
      </ul>
    </div>
  );
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

/**
 * "Sem correspondência" — receipts the matcher couldn't tie to ANY charge
 * (candidateIds empty). On a 200+-entry comprovante most of these are unrelated
 * payments (health plans, suppliers). Hidden by default so they don't drown the
 * real review work; expandable to inspect, with a one-click bulk reject.
 */
function NoMatchSection({
  rows,
  columns,
  isOperator,
  invalidate,
}: {
  rows: ReviewReceiptRow[];
  columns: ColumnDef<ReviewReceiptRow, unknown>[];
  isOperator: boolean;
  invalidate: QueryKey[];
}) {
  const [open, setOpen] = React.useState(false);
  const { run, pending } = useRunAction();

  if (rows.length === 0) return null;

  function onRejectAll() {
    const ok = window.confirm(
      `Descartar ${rows.length} recibo(s) sem correspondência? ` +
        "Eles não casaram com nenhuma cobrança e sairão da fila (marcados como não relacionados). " +
        "Recibos que já tenham pagamento vinculado são ignorados.",
    );
    if (!ok) return;
    void run(
      () => rejectReceipts(rows.map((r) => r.id), "descartado em lote (sem correspondência)"),
      {
        success: "Recibos sem correspondência descartados",
        invalidate,
      },
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium"
        >
          {open ? (
            <ChevronDown className="size-4" strokeWidth={2} />
          ) : (
            <ChevronRight className="size-4" strokeWidth={2} />
          )}
          Sem correspondência
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        </button>
        <span className="text-xs text-muted-foreground">
          não casaram com nenhuma cobrança — provavelmente não relacionados
        </span>
        <Gate isOperator={isOperator}>
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            disabled={!isOperator || pending}
            onClick={onRejectAll}
          >
            <Trash2 className="size-3" strokeWidth={2} />
            Descartar {rows.length}
          </Button>
        </Gate>
      </div>

      {open ? (
        <div className="border-t border-border p-2">
          <DataTable
            columns={columns}
            data={rows}
            searchPlaceholder="Buscar sem correspondência…"
            csvFilename="comprovantes-sem-correspondencia"
            filterableColumnIds="all"
            emptyMessage="Nenhum recibo sem correspondência."
          />
        </div>
      ) : null}
    </div>
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
  const [confirmTarget, setConfirmTarget] = React.useState<ConfirmTarget | null>(null);

  const { data = initialData } = useQuery({
    queryKey: REVIEW_KEY,
    queryFn: fetchReviewData,
    initialData,
  });

  // Split: receipts with ranked candidates (a human should pick) vs receipts
  // that matched nothing (candidateIds empty → "sem correspondência", hidden).
  const { withCandidates, noMatch } = React.useMemo(() => {
    const withCandidates: ReviewReceiptRow[] = [];
    const noMatch: ReviewReceiptRow[] = [];
    for (const r of data.rows) {
      (r.candidateIds.length > 0 ? withCandidates : noMatch).push(r);
    }
    return { withCandidates, noMatch };
  }, [data.rows]);

  // Symmetric N↔N ambiguous groups (one landlord, N same-value charges) — the
  // one-click resolver. Built from the with-candidates set.
  const resolvableGroups = React.useMemo(
    () => buildResolvableGroups(withCandidates),
    [withCandidates],
  );

  const columns = React.useMemo<ColumnDef<ReviewReceiptRow, unknown>[]>(() => {
    const openPicker = (row: ReviewReceiptRow, preselect: string | null) =>
      setTarget({ row, preselect });
    // Candidate chip → one-click confirm (needs the parsed amount to record the
    // payment); without an amount the full picker still handles it.
    const openCandidate = (row: ReviewReceiptRow, candidate: ReviewCandidate) => {
      if (row.amount !== null) setConfirmTarget({ row, candidate });
      else setTarget({ row, preselect: candidate.id });
    };

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
                    onClick={() => openCandidate(row.original, c)}
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

      <ResolvableGroups
        groups={resolvableGroups}
        isOperator={viewer.isOperator}
        invalidate={[REVIEW_KEY, ["comprovantes-inbox"]]}
      />

      <DataTable
        columns={columns}
        data={withCandidates}
        searchPlaceholder="Buscar documento, chave, identificação…"
        csvFilename="comprovantes-revisao"
        filterableColumnIds="all"
        emptyMessage="Nenhum comprovante aguardando decisão."
      />

      <NoMatchSection
        rows={noMatch}
        columns={columns}
        isOperator={viewer.isOperator}
        invalidate={[REVIEW_KEY, ["comprovantes-inbox"]]}
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

      <ConfirmBindDialog
        target={confirmTarget}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        isOperator={viewer.isOperator}
        invalidate={[REVIEW_KEY, ["comprovantes-inbox"]]}
      />
    </div>
  );
}
