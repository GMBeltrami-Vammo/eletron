"use client";

/**
 * "A pagar" (spec 2026-07-11, Peça 1): the operational payables queue — every
 * OPEN charge ordered by vencimento, with the payment code (linha digitável or
 * chave PIX) copyable in one click for manual execution at the bank (no bank
 * integration by design). Station-less charges (caso DIA) APPEAR here — they
 * are payable before identification; "Identificar" jumps to the review queue.
 * Paid → the comprovante flow gives baixa (pago ⟺ comprovante, #29/#44).
 */

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Copy, SearchCheck } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/vammo/data-table";
import { StatCard } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  CHARGE_KIND_UI,
  CHARGE_STATUS_UI,
  PAYMENT_METHOD_LABEL,
} from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

import type { PagamentoRow } from "./types";

/** Open = still needs money to leave the bank. */
export const A_PAGAR_STATUSES = [
  "pendente",
  "boleto_recebido",
  "atrasado",
] as const;

export function isAPagar(r: PagamentoRow): boolean {
  if (!(A_PAGAR_STATUSES as readonly string[]).includes(r.status)) return false;
  // Energy bills on débito automático are paid by the bank automatically — they
  // are NOT manual payables, so they must not appear here nor inflate the
  // queue's headline "A pagar"/"Vencidas" totals (energy WITHOUT DA still needs
  // manual payment and stays). Rent/third-party (autoDebit null) always stay.
  const isEnergy =
    r.accountType === "energy_enel" || r.accountType === "energy_edp";
  if (isEnergy && r.autoDebit === "cadastrado") return false;
  return true;
}

/** dueDate asc, nulls last — the queue's operational order. */
export function aPagarSort(a: PagamentoRow, b: PagamentoRow): number {
  if (a.dueDate === null && b.dueDate === null) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

export function daysUntil(iso: string, todayIso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const t = new Date(`${todayIso}T00:00:00`);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function VencimentoCell({
  dueDate,
  todayIso,
}: {
  dueDate: string | null;
  todayIso: string;
}) {
  if (!dueDate) return <span className="text-muted-foreground">—</span>;
  const days = daysUntil(dueDate, todayIso);
  const badge =
    days < 0 ? (
      <StatusBadge color="red">{-days}d atrás</StatusBadge>
    ) : days === 0 ? (
      <StatusBadge color="orange">hoje</StatusBadge>
    ) : days <= 7 ? (
      <StatusBadge color="orange" outline>{`em ${days}d`}</StatusBadge>
    ) : null;
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      {formatDate(dueDate)}
      {badge}
    </span>
  );
}

/** One-click copy of the payment code (linha digitável / chave PIX). */
function CopyCodeButton({ code, kind }: { code: string; kind: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          toast.success(`${kind} copiada`);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      title={`Copiar ${kind}: ${code}`}
      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs hover:bg-muted"
    >
      {copied ? (
        <Check className="size-3.5 shrink-0 text-success-emphasis" strokeWidth={2.5} />
      ) : (
        <Copy className="size-3.5 shrink-0" strokeWidth={2} />
      )}
      <span className="truncate">{code}</span>
    </button>
  );
}

export function APagarPanel({
  rows,
  monthLabel,
  actionsColumn,
  onRowClick,
}: {
  /** Pre-filtered open rows (isAPagar), unsorted. */
  rows: PagamentoRow[];
  monthLabel: string;
  /** The shared "acoes" column (StatusActions) from the view. */
  actionsColumn: ColumnDef<PagamentoRow, unknown>;
  onRowClick?: (row: PagamentoRow) => void;
}) {
  // Client-rendered "today" (BRT wall clock of the viewer) for urgency badges.
  const todayIso = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const sorted = React.useMemo(() => [...rows].sort(aPagarSort), [rows]);

  const totals = React.useMemo(() => {
    let total = 0;
    let vencidas = 0;
    let vencidasSum = 0;
    let semana = 0;
    for (const r of sorted) {
      total += r.amount ?? r.expectedAmount ?? 0;
      if (r.dueDate) {
        const d = daysUntil(r.dueDate, todayIso);
        if (d < 0) {
          vencidas += 1;
          vencidasSum += r.amount ?? r.expectedAmount ?? 0;
        } else if (d <= 7) semana += 1;
      }
    }
    return { total, vencidas, vencidasSum, semana };
  }, [sorted, todayIso]);

  const columns = React.useMemo<ColumnDef<PagamentoRow, unknown>[]>(
    () => [
      {
        id: "vencimento",
        header: "Vencimento",
        accessorFn: (r) => r.dueDate ?? "9999-12-31",
        cell: ({ row }) => (
          <VencimentoCell dueDate={row.original.dueDate} todayIso={todayIso} />
        ),
      },
      {
        id: "estacao",
        header: "Estação",
        accessorFn: (r) => r.stationId ?? -1,
        cell: ({ row }) => {
          const r = row.original;
          if (r.stationId === null) {
            return (
              <Link
                href="/revisao/cobrancas"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-medium text-warning-emphasis underline-offset-2 hover:underline"
                title="Sem estação — abrir a revisão para identificar"
              >
                <SearchCheck className="size-3.5" strokeWidth={2} />
                Identificar
              </Link>
            );
          }
          return (
            <span className="tabular-nums">
              #{r.stationId}
              {r.stationName ? (
                <span className="text-muted-foreground"> {r.stationName}</span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "parceiro",
        header: "Parceiro",
        accessorFn: (r) => r.parceiro ?? "",
        cell: ({ row }) => (
          <span
            className="block max-w-[180px] truncate"
            title={row.original.parceiro ?? undefined}
          >
            {row.original.parceiro ?? "—"}
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
        id: "valor",
        header: "Valor",
        accessorFn: (r) => r.amount ?? r.expectedAmount ?? 0,
        cell: ({ row }) => (
          <span className="block text-right font-medium tabular-nums">
            {formatBRL(row.original.amount ?? row.original.expectedAmount)}
          </span>
        ),
        meta: { csvValue: (r: PagamentoRow) => r.amount ?? r.expectedAmount },
      },
      {
        id: "metodo",
        header: "Método",
        accessorFn: (r) =>
          r.paymentMethod ? PAYMENT_METHOD_LABEL[r.paymentMethod] : "",
        cell: ({ row }) => {
          const m = row.original.paymentMethod;
          return m ? (
            <span className="text-xs">{PAYMENT_METHOD_LABEL[m]}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "codigo",
        header: "Código de pagamento",
        enableSorting: false,
        accessorFn: (r) => r.linhaDigitavel ?? r.chavePix ?? "",
        cell: ({ row }) => {
          const r = row.original;
          if (r.linhaDigitavel) {
            return <CopyCodeButton code={r.linhaDigitavel} kind="Linha digitável" />;
          }
          if (r.chavePix) {
            return <CopyCodeButton code={r.chavePix} kind="Chave PIX" />;
          }
          return <span className="text-xs text-muted-foreground">—</span>;
        },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => CHARGE_STATUS_UI[r.status].label,
        cell: ({ row }) => {
          const ui = CHARGE_STATUS_UI[row.original.status];
          return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
        },
      },
      actionsColumn,
    ],
    [todayIso, actionsColumn],
  );

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={`A pagar (${monthLabel})`}
          value={formatBRL(totals.total)}
          sub={`${sorted.length} cobranças em aberto`}
        />
        <StatCard
          label="Vencidas"
          value={formatBRL(totals.vencidasSum)}
          sub={`${totals.vencidas} cobrança(s)`}
          tone={totals.vencidas > 0 ? "error" : "default"}
        />
        <StatCard
          label="Vencem em 7 dias"
          value={String(totals.semana)}
          sub="cobranças"
          tone={totals.semana > 0 ? "warning" : "default"}
        />
      </div>
      <DataTable
        columns={columns}
        data={sorted}
        searchPlaceholder="Buscar estação, parceiro, código…"
        csvFilename="pagamentos-a-pagar"
        initialSorting={[{ id: "vencimento", desc: false }]}
        filterableColumnIds="all"
        pinnedRightColumnIds={["acoes"]}
        onRowClick={onRowClick}
        emptyMessage="Nada a pagar para o período — tudo em dia."
      />
    </>
  );
}
