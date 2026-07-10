"use client";

/**
 * One card per parsed receipt (a `charging.receipts` row). Shows the parsed
 * fields, the `receipt_type` badge, and the match badge with its action:
 *   Conciliado (green) · Conciliado (aguardando confirmação) → Confirmar
 *   (confirm_charge) · Ambíguo → link to review · Sem correspondência →
 *   "Conciliar…" (opens the charge picker). Nothing auto-matched ever shows a
 *   bare "Pago" (decision #24). Excess-of-info: raw text behind a disclosure.
 */

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FileSearch, Link2 } from "lucide-react";
import type { QueryKey } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/vammo/status-badge";
import { confirmCharge } from "@/app/actions/charges";
import { formatBRL, formatDate } from "@/lib/format";
import { formatCnpjCpf } from "@/components/revisao/labels";

import { ChargePicker } from "./charge-picker";
import { RECEIPT_TYPE_UI } from "./labels";
import type { ReceiptView } from "./types";
import { Gate, useRunAction } from "./write-helpers";

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm"}>
        {value}
      </dd>
    </div>
  );
}

export function ReceiptCard({
  receipt,
  documentId,
  isOperator,
  onJumpToPage,
  invalidate,
}: {
  receipt: ReceiptView;
  documentId: string;
  isOperator: boolean;
  onJumpToPage: (page: number) => void;
  invalidate: QueryKey[];
}) {
  const { run, pending } = useRunAction();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const typeUi = RECEIPT_TYPE_UI[receipt.receiptType];

  async function confirm() {
    const chargeId = receipt.awaitingChargeId;
    if (!chargeId) return;
    await run(() => confirmCharge({ chargeId }), {
      success: "Cobrança confirmada como paga",
      invalidate,
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={() => onJumpToPage(receipt.pageNumber)}
            title="Ir para a página no PDF"
          >
            <FileSearch className="size-3" strokeWidth={2} />
            Página {receipt.pageNumber}
            {receipt.segmentIndex > 0 ? ` · seg ${receipt.segmentIndex}` : ""}
          </Button>
          <a
            href={`/api/files/${documentId}/page/${receipt.pageNumber}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
            title="Abrir só esta página (PDF isolado)"
          >
            <ExternalLink className="size-3" strokeWidth={2} />
            Ver página
          </a>
          <StatusBadge color={typeUi.color}>{typeUi.label}</StatusBadge>
        </div>
        <MatchBadge
          receipt={receipt}
          isOperator={isOperator}
          pending={pending}
          onConfirm={confirm}
          onConciliar={() => setPickerOpen(true)}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Field label="Valor" value={receipt.amount !== null ? formatBRL(receipt.amount) : null} />
        <Field label="Data" value={receipt.paidAt ? formatDate(receipt.paidAt) : null} />
        <Field label="Chave PIX" value={receipt.chavePix} mono />
        <Field
          label="CNPJ/CPF"
          value={receipt.cnpjCpf ? formatCnpjCpf(receipt.cnpjCpf) : null}
          mono
        />
        <Field label="Banco" value={receipt.banco} />
        <Field label="Agência" value={receipt.agencia} mono />
        <Field label="Conta" value={receipt.conta} mono />
        <Field label="Identificação" value={receipt.identificacao} />
        <Field label="Autenticação" value={receipt.autenticacao} mono />
        <Field label="Código de barras" value={receipt.codigoBarras} mono />
      </dl>

      {receipt.rawText ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Ver texto bruto
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
            {receipt.rawText}
          </pre>
        </details>
      ) : null}

      <ChargePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        receipt={receipt}
        isOperator={isOperator}
        invalidate={invalidate}
      />
    </div>
  );
}

function MatchBadge({
  receipt,
  isOperator,
  pending,
  onConfirm,
  onConciliar,
}: {
  receipt: ReceiptView;
  isOperator: boolean;
  pending: boolean;
  onConfirm: () => void;
  onConciliar: () => void;
}) {
  switch (receipt.badge) {
    case "conciliado":
      return <StatusBadge color="green">Conciliado</StatusBadge>;
    case "awaiting":
      return (
        <div className="flex items-center gap-2">
          <StatusBadge color="orange">
            Conciliado (aguardando confirmação)
          </StatusBadge>
          <Gate isOperator={isOperator}>
            <Button
              size="xs"
              variant="outline"
              disabled={!isOperator || pending}
              onClick={onConfirm}
            >
              <CheckCircle2 className="size-3" strokeWidth={2} />
              Confirmar
            </Button>
          </Gate>
        </div>
      );
    case "ambiguous":
      return (
        <div className="flex items-center gap-2">
          <StatusBadge color="orange" outline>
            Ambíguo
          </StatusBadge>
          <Button
            size="xs"
            variant="ghost"
            render={<Link href="/revisao/comprovantes" />}
          >
            Revisar
          </Button>
        </div>
      );
    case "unmatched":
    default:
      return (
        <div className="flex items-center gap-2">
          <StatusBadge color="red">Sem correspondência</StatusBadge>
          <Gate isOperator={isOperator}>
            <Button
              size="xs"
              variant="outline"
              disabled={!isOperator}
              onClick={onConciliar}
            >
              <Link2 className="size-3" strokeWidth={2} />
              Conciliar…
            </Button>
          </Gate>
        </div>
      );
  }
}
