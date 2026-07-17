"use client";

/**
 * Row-click detail + edit drawer for /pagamentos. Clicking any ledger row opens
 * this Sheet: a readable, single-charge view of every field plus the same
 * edit actions as the (now pinned) row menu (StatusActions). The pinned column
 * and this drawer are the two reachability paths Gabriel asked for ("os dois").
 */

import * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ComprovanteCell } from "@/components/vammo/comprovante-cell";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  ACCOUNT_TYPE_UI,
  AUTO_DEBIT_UI,
  CHARGE_KIND_UI,
  CHARGE_STATUS_UI,
  FISCAL_EXPORT_UI,
  PAYMENT_METHOD_LABEL,
} from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

import type { PagamentoRow } from "./types";
import { StatusActions } from "./status-actions";
import { FlagBadges } from "./flag-badges";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

function DrawerBody({
  row,
  canWrite,
  isAdmin,
}: {
  row: PagamentoRow;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const kindUi = CHARGE_KIND_UI[row.kind];
  const statusUi = CHARGE_STATUS_UI[row.status];
  const partner =
    row.parceiro ??
    (row.accountType ? ACCOUNT_TYPE_UI[row.accountType]?.label : null) ??
    "—";
  const mismatch =
    row.expectedAmount !== null &&
    row.amount !== null &&
    Math.abs(row.expectedAmount - row.amount) > 0.005;

  return (
    <div className="space-y-4">
      <SheetHeader className="p-0">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {row.stationId !== null ? (
            <Link
              href={`/estacoes/${row.stationId}`}
              className="tabular-nums hover:underline"
            >
              #{row.stationId}
            </Link>
          ) : (
            <span className="text-muted-foreground">Sem estação</span>
          )}
          {row.stationName ? (
            <span className="font-normal text-muted-foreground">
              {row.stationName}
            </span>
          ) : null}
        </SheetTitle>
        <SheetDescription>
          <StatusBadge color={kindUi.color}>{kindUi.label}</StatusBadge>{" "}
          {formatCompetencia(row.competencia)} · {partner}
        </SheetDescription>
      </SheetHeader>

      {/* Edit actions — the same menu as the pinned row column. */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
        <span className="text-sm font-medium">Ações da cobrança</span>
        <StatusActions row={row} canWrite={canWrite} isAdmin={isAdmin} />
      </div>

      <div className="divide-y divide-border rounded-lg border border-border px-3">
        <Field label="Instalação">{row.installationKey ?? "—"}</Field>
        <Field label="Vencimento">
          <span className="tabular-nums">
            {row.dueDate ? formatDate(row.dueDate) : "—"}
          </span>
        </Field>
        <Field label="Débito automático">
          {row.autoDebit ? (
            <StatusBadge color={AUTO_DEBIT_UI[row.autoDebit].color}>
              {AUTO_DEBIT_UI[row.autoDebit].label}
            </StatusBadge>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Valor">
          <span className="font-medium tabular-nums">
            {formatBRL(row.amount)}
          </span>
        </Field>
        {mismatch ? (
          <Field label="Previsto">
            <span className="tabular-nums text-warning-emphasis">
              {formatBRL(row.expectedAmount)}
            </span>
          </Field>
        ) : null}
        <Field label="Status">
          <StatusBadge color={statusUi.color}>{statusUi.label}</StatusBadge>
        </Field>
        <Field label="Método">
          {row.paymentMethod ? PAYMENT_METHOD_LABEL[row.paymentMethod] : "—"}
        </Field>
        <Field label="Comprovante">
          <ComprovanteCell
            dedupeKey={row.chargeId}
            amount={row.amount}
            summary={row.payment}
          />
        </Field>
        <Field label="Documento de origem">
          {row.documentHref ? (
            <a
              href={row.documentHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
            >
              Ver documento
              <ExternalLink className="size-3.5" strokeWidth={2} />
            </a>
          ) : (
            "—"
          )}
        </Field>
        <Field label={FISCAL_EXPORT_UI.header}>
          {row.fiscalExported ? FISCAL_EXPORT_UI.yes : FISCAL_EXPORT_UI.no}
        </Field>
        <Field label="Nota fiscal">
          <span className="tabular-nums">{row.notaFiscal ?? "—"}</span>
        </Field>
        {row.flags.length > 0 ? (
          <Field label="Sinalizações">
            <FlagBadges flags={row.flags} />
          </Field>
        ) : null}
        {row.notes ? (
          <Field label="Observações">
            <span className="text-muted-foreground">{row.notes}</span>
          </Field>
        ) : null}
      </div>
    </div>
  );
}

export function PagamentoDrawer({
  row,
  open,
  onOpenChange,
  canWrite,
  isAdmin,
}: {
  row: PagamentoRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  // Keep the last row visible through the close animation (row goes null on close).
  const [shown, setShown] = React.useState<PagamentoRow | null>(row);
  React.useEffect(() => {
    if (row) setShown(row);
  }, [row]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto p-4 sm:max-w-md">
        {shown ? (
          <DrawerBody row={shown} canWrite={canWrite} isAdmin={isAdmin} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
