"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { CHARGE_KIND_UI, CHARGE_STATUS_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";
import type { Charge, ChargeLine } from "@/lib/domain";

import { CHARGE_LINE_KIND_LABEL } from "./helpers";

type PaymentRow = { charge: Charge; lines: ChargeLine[] };

/**
 * Station rent/third-party ledger. Energy-only charges live in the Energia
 * tab; this table carries aluguel and aluguel+energia rows with their
 * structured sub-values (expected amount + charge_lines split — never the
 * raw text blob).
 */
export function PaymentsTab({ data }: { data: Station360 }) {
  const rentishAccountIds = new Set(
    data.accounts
      .filter(
        (a) =>
          a.account.accountType === "rent" ||
          a.account.accountType === "third_party",
      )
      .map((a) => a.account.id),
  );
  const linesByCharge = new Map<string, ChargeLine[]>();
  for (const line of data.chargeLines) {
    const list = linesByCharge.get(line.chargeId) ?? [];
    list.push(line);
    linesByCharge.set(line.chargeId, list);
  }

  const rows: PaymentRow[] = data.charges
    .filter(
      (c) =>
        (c.billingAccountId !== null &&
          rentishAccountIds.has(c.billingAccountId)) ||
        c.kind === "aluguel" ||
        c.kind === "aluguel_energia",
    )
    .map((charge) => ({ charge, lines: linesByCharge.get(charge.id) ?? [] }));

  return (
    <DataTable<PaymentRow>
      columns={paymentColumns}
      data={rows}
      csvFilename={`pagamentos-estacao-${data.station.id}`}
      initialSorting={[{ id: "competencia", desc: true }]}
      searchPlaceholder="Buscar cobrança…"
      emptyMessage="Nenhuma cobrança de aluguel registrada."
    />
  );
}

const paymentColumns: ColumnDef<PaymentRow, unknown>[] = [
  {
    id: "competencia",
    header: "Competência",
    accessorFn: (r) => r.charge.competencia ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCompetencia(row.original.charge.competencia)}
      </span>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    accessorFn: (r) => CHARGE_KIND_UI[r.charge.kind].label,
    cell: ({ row }) => {
      const ui = CHARGE_KIND_UI[row.original.charge.kind];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (r) => r.charge.amount ?? 0,
    cell: ({ row }) => {
      const { charge, lines } = row.original;
      return (
        <span className="block text-right tabular-nums">
          <span className="font-medium">{formatBRL(charge.amount)}</span>
          {charge.expectedAmount !== null &&
          charge.expectedAmount !== charge.amount ? (
            <span className="block text-xs text-muted-foreground">
              previsto {formatBRL(charge.expectedAmount)}
            </span>
          ) : null}
          {lines.map((line) => (
            <span key={line.id} className="block text-xs text-muted-foreground">
              {CHARGE_LINE_KIND_LABEL[line.lineKind]}{" "}
              {formatBRL(line.amount)}
            </span>
          ))}
        </span>
      );
    },
    meta: { csvValue: (r: PaymentRow) => r.charge.amount ?? "" },
  },
  {
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (r) => r.charge.dueDate ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatDate(row.original.charge.dueDate)}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => CHARGE_STATUS_UI[r.charge.status].label,
    cell: ({ row }) => {
      const ui = CHARGE_STATUS_UI[row.original.charge.status];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "documento",
    header: "Documento",
    accessorFn: (r) =>
      r.charge.documentoNumero ?? r.charge.notaFiscal ?? "",
    cell: ({ row }) => {
      const { documentoNumero, notaFiscal } = row.original.charge;
      const ref = documentoNumero ?? notaFiscal;
      return ref ? (
        <span className="font-mono text-xs">{ref}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    id: "observacoes",
    header: "Observações",
    enableSorting: false,
    accessorFn: (r) => r.charge.notes ?? "",
    cell: ({ row }) =>
      row.original.charge.notes ? (
        <span
          className="block max-w-56 truncate text-xs text-muted-foreground"
          title={row.original.charge.notes}
        >
          {row.original.charge.notes}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];
