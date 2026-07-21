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
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatCnpjCpf } from "@/components/revisao/labels";
import { rejectReceipt, rejectReceipts } from "@/app/actions/comprovantes";
import { resolveReceiptGroup } from "@/app/actions/charges";
import { CHARGE_KIND_UI, CHARGE_STATUS_UI, MATCH_STATUS_UI } from "@/lib/labels";
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

/** digits-only, leading-zero-insensitive equality (display-only ✓ hint). */
function digitsEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const da = a.replace(/\D/g, "").replace(/^0+/, "");
  const db = b.replace(/\D/g, "").replace(/^0+/, "");
  return da.length > 0 && da === db;
}

/** Best-effort recebedor/favorecido name from the receipt's raw page text. */
function receiverName(raw: string | null): string | null {
  if (!raw) return null;
  const m =
    raw.match(/nome\s+do\s+recebedor\s*:?\s*([^\n]+)/i) ??
    raw.match(/nome\s+do\s+favorecido\s*:?\s*([^\n]+)/i) ??
    raw.match(/creditada:[\s\S]*?nome\s*:?\s*([^\n]+)/i);
  const name = m?.[1]?.trim();
  return name && name.length > 1 ? name : null;
}

/** One labeled field; `match` renders a green check, `strong` bolds the value. */
function Field({
  label,
  value,
  mono,
  strong,
  match,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  match?: boolean;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={[
          "flex min-w-0 items-center gap-1 text-right",
          mono ? "font-mono text-xs" : "text-sm",
          strong ? "font-semibold" : "",
        ].join(" ")}
      >
        <span className="truncate">{value}</span>
        {match ? (
          <Check className="size-3.5 shrink-0 text-success-emphasis" strokeWidth={2.5} />
        ) : null}
      </span>
    </div>
  );
}

/**
 * One-click candidate confirmation: clicking a candidate chip opens this
 * recibo × cobrança comparison so a human can say yes/no at a glance — both
 * sides' valor, chave/CNPJ, and names lined up (matched fields get a ✓), plus a
 * "Ver página" link to the actual receipt PDF. Confirming records the payment
 * directly (the same record_payment call the full picker makes). Only offered
 * when the receipt has a parsed amount; otherwise the chip opens the full picker.
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

  const valorMatch =
    row.amount !== null &&
    candidate.amount !== null &&
    Math.abs(row.amount - candidate.amount) <= 0.01;
  const chaveMatch = digitsEqual(row.chavePix, candidate.chavePix);
  // CNPJ can appear as chave on one side and issuer on the other — cross-check.
  const cnpjMatch =
    digitsEqual(row.cnpjCpf, candidate.issuerCnpj) ||
    digitsEqual(row.chavePix, candidate.issuerCnpj) ||
    digitsEqual(row.cnpjCpf, candidate.chavePix);
  const agConta = (ag: string | null, ct: string | null) =>
    ag && ct ? `ag ${ag} / cc ${ct}` : null;
  const recebedor = receiverName(row.rawText);
  const pageHref = `/api/files/${row.documentId}/page/${row.pageNumber}`;

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
      <DialogContent className="max-w-lg sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar conciliação</DialogTitle>
          <DialogDescription>
            Compare o comprovante e a cobrança. Ao confirmar, o recibo é
            vinculado e a cobrança marcada como paga quando o valor a cobre.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* ── Comprovante ── */}
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comprovante
              </span>
              <StatusBadge color={typeUi.color}>{typeUi.label}</StatusBadge>
            </div>
            <Field label="Valor" value={formatBRL(row.amount)} strong match={valorMatch} />
            <Field label="Data" value={formatDate(row.paidAt)} />
            <Field label="Recebedor" value={recebedor} />
            <Field label="Chave PIX" value={row.chavePix} mono match={chaveMatch} />
            <Field
              label="CNPJ/CPF"
              value={row.cnpjCpf ? formatCnpjCpf(row.cnpjCpf) : null}
              mono
              match={cnpjMatch}
            />
            <Field label="Ag/Conta" value={agConta(row.agencia, row.conta)} mono />
            <Field label="Banco" value={row.banco} />
            <Field label="Identificação" value={row.identificacao} />
            <div className="pt-1">
              <a
                href={pageHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
              >
                <FileText className="size-3.5" strokeWidth={2} />
                Ver página {row.pageNumber}
                <ExternalLink className="size-3" strokeWidth={2} />
              </a>
            </div>
          </div>

          {/* ── Cobrança ── */}
          <div className="space-y-1.5 rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cobrança
              </span>
              <StatusBadge color={CHARGE_KIND_UI[candidate.kind].color}>
                {CHARGE_KIND_UI[candidate.kind].label}
              </StatusBadge>
            </div>
            <Field label="Valor" value={formatBRL(candidate.amount)} strong match={valorMatch} />
            <Field label="Competência" value={formatCompetencia(candidate.competencia)} />
            <Field label="Vencimento" value={formatDate(candidate.dueDate)} />
            <Field
              label="Contraparte"
              value={candidate.counterpartyName}
              strong
            />
            <Field
              label="Estação"
              value={
                candidate.stationId !== null
                  ? `#${candidate.stationId}${candidate.stationName ? ` ${candidate.stationName}` : ""}`
                  : null
              }
            />
            <Field label="Chave PIX" value={candidate.chavePix} mono match={chaveMatch} />
            <Field
              label="CNPJ/CPF"
              value={candidate.issuerCnpj ? formatCnpjCpf(candidate.issuerCnpj) : null}
              mono
              match={cnpjMatch}
            />
            <Field label="Ag/Conta" value={agConta(candidate.agencia, candidate.conta)} mono />
            <Field
              label="Status"
              value={
                <StatusBadge color={CHARGE_STATUS_UI[candidate.status].color} outline>
                  {CHARGE_STATUS_UI[candidate.status].label}
                </StatusBadge>
              }
            />
          </div>
        </div>

        {!valorMatch ? (
          <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-emphasis">
            Os valores não são idênticos ({formatBRL(row.amount)} × {formatBRL(candidate.amount)}) —
            confira antes de conciliar.
          </p>
        ) : null}

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

/** pt-BR money string → number for the value filter (null when empty/invalid). */
function parseValorFilter(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
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
  // Value filter (Gabriel 2026-07-14): type a value to see only the receipts at
  // ≈ that amount (±R$0,50) — for cross-checking against charges of the same
  // value whose keys diverge.
  const [valor, setValor] = React.useState("");

  const { data = initialData } = useQuery({
    queryKey: REVIEW_KEY,
    queryFn: fetchReviewData,
    initialData,
  });

  const valorNum = parseValorFilter(valor);
  const filteredRows = React.useMemo(() => {
    if (valorNum === null) return data.rows;
    return data.rows.filter(
      (r) => r.amount !== null && Math.abs(r.amount - valorNum) <= 0.5,
    );
  }, [data.rows, valorNum]);

  // Split: receipts with ranked candidates (a human should pick) vs receipts
  // that matched nothing (candidateIds empty → "sem correspondência", hidden).
  const { withCandidates, noMatch } = React.useMemo(() => {
    const withCandidates: ReviewReceiptRow[] = [];
    const noMatch: ReviewReceiptRow[] = [];
    for (const r of filteredRows) {
      (r.candidateIds.length > 0 ? withCandidates : noMatch).push(r);
    }
    return { withCandidates, noMatch };
  }, [filteredRows]);

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
          <div className="max-w-[240px]">
            {/* deep-link to the deep-dive AT this receipt's page (?page jumps the viewer) */}
            <Link
              href={`/comprovantes/${row.original.documentId}?page=${row.original.pageNumber}`}
              className="block underline-offset-2 hover:underline"
              title={row.original.filename ?? undefined}
            >
              <span className="block truncate font-medium">
                {row.original.filename ?? "(sem nome)"}
              </span>
            </Link>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <span>
                página {row.original.pageNumber}
                {row.original.segmentIndex > 0
                  ? ` · seg ${row.original.segmentIndex}`
                  : ""}
              </span>
              {/* open just this page's PDF, isolated */}
              <a
                href={`/api/files/${row.original.documentId}/page/${row.original.pageNumber}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline-offset-2 hover:underline"
                title="Abrir só esta página (PDF)"
              >
                <FileText className="size-3" strokeWidth={2} />
                ver
              </a>
            </span>
          </div>
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

      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Filtrar por valor…"
          aria-label="Filtrar comprovantes por valor"
          className="h-8 w-40 rounded-md border border-border bg-card px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {valorNum !== null ? (
          <span className="text-xs text-muted-foreground">
            {filteredRows.length} comprovante(s) a ±R$0,50 de {formatBRL(valorNum)}
            <button
              type="button"
              onClick={() => setValor("")}
              className="ml-1.5 underline underline-offset-2 hover:text-foreground"
            >
              limpar
            </button>
          </span>
        ) : null}
      </div>

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
            amount: target.row.amount,
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
