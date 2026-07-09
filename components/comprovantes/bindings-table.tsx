"use client";

/**
 * Vínculos (payments) table for the deep-dive: one row per `charging.payments`
 * row of the document. A linked comprovante is paid — auto-matches land the
 * charge on 'pago' directly, so the row shows "Pago". Confirmar still runs
 * `confirm_charge` for any legacy 'conciliado' charge; Remover runs
 * `unmatch_payment` behind a confirm dialog (the charge walks back to open).
 * Footer reconciles allocated vs. receipts total.
 */

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Trash2 } from "lucide-react";
import type { QueryKey } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuditByline } from "@/components/vammo/audit-byline";
import { StatusBadge } from "@/components/vammo/status-badge";
import { confirmCharge, unmatchPayment } from "@/app/actions/charges";
import { CHARGE_KIND_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia } from "@/lib/format";

import type { DeepDiveData, PaymentView } from "./types";
import { Gate, useRunAction } from "./write-helpers";

export function BindingsTable({
  payments,
  totals,
  isOperator,
  invalidate,
}: {
  payments: PaymentView[];
  totals: DeepDiveData["totals"];
  isOperator: boolean;
  invalidate: QueryKey[];
}) {
  const { run, pending } = useRunAction();
  const [removing, setRemoving] = React.useState<PaymentView | null>(null);
  const [reason, setReason] = React.useState("");

  async function confirmRow(chargeId: string) {
    await run(() => confirmCharge({ chargeId }), {
      success: "Cobrança confirmada como paga",
      invalidate,
    });
  }

  async function removeBinding() {
    if (!removing) return;
    const ok = await run(
      () =>
        unmatchPayment({
          paymentId: removing.id,
          reason: reason.trim() || "vínculo removido manualmente",
        }),
      { success: "Vínculo removido", invalidate },
    );
    if (ok) {
      setRemoving(null);
      setReason("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Cobrança</TableHead>
              <TableHead className="text-right text-xs">Valor alocado</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-right text-xs">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-20 text-center text-sm text-muted-foreground"
                >
                  Nenhum vínculo ainda.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="py-2 align-top text-sm">
                    <div className="flex flex-col gap-1">
                      {p.stationId !== null ? (
                        <Link
                          href={`/estacoes/${p.stationId}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          <span className="tabular-nums">#{p.stationId}</span>
                          {p.stationName ? ` — ${p.stationName}` : ""}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Sem estação</span>
                      )}
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <StatusBadge color={CHARGE_KIND_UI[p.chargeKind].color}>
                          {CHARGE_KIND_UI[p.chargeKind].label}
                        </StatusBadge>
                        <span className="tabular-nums">
                          {formatCompetencia(p.chargeCompetencia)}
                        </span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right align-top text-sm tabular-nums">
                    {formatBRL(p.amount)}
                  </TableCell>
                  <TableCell className="py-2 align-top text-sm">
                    {p.confirmed ? (
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge color="green">Pago</StatusBadge>
                        <span className="text-xs text-muted-foreground">
                          {p.source === "auto_match"
                            ? "vínculo automático"
                            : "vínculo manual"}
                        </span>
                        <AuditByline
                          actorEmail={p.createdByEmail}
                          at={p.paidAt ?? p.createdAt}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge color="orange">
                          Aguardando confirmação
                        </StatusBadge>
                        <span className="text-xs text-muted-foreground">
                          conciliado (linha antiga)
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-right align-top">
                    <div className="flex justify-end gap-1">
                      {!p.confirmed ? (
                        <Gate isOperator={isOperator}>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={!isOperator || pending}
                            onClick={() => confirmRow(p.chargeId)}
                          >
                            <CheckCircle2 className="size-3" strokeWidth={2} />
                            Confirmar
                          </Button>
                        </Gate>
                      ) : null}
                      <Gate isOperator={isOperator}>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!isOperator || pending}
                          onClick={() => {
                            setRemoving(p);
                            setReason("");
                          }}
                        >
                          <Trash2 className="size-3" strokeWidth={2} />
                          Remover
                        </Button>
                      </Gate>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>
          Total alocado:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {formatBRL(totals.allocatedSum)}
          </span>
        </span>
        <span>
          Recibos:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {formatBRL(totals.receiptsSum)}
          </span>
        </span>
        <span>
          Restante:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {formatBRL(totals.remaining)}
          </span>
        </span>
      </div>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover vínculo?</DialogTitle>
            <DialogDescription>
              A cobrança volta a ficar em aberto. A remoção fica registrada na
              auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="remove-reason">Motivo</Label>
            <Textarea
              id="remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: recibo vinculado à cobrança errada"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={removeBinding}
            >
              <Trash2 className="size-4" strokeWidth={2} />
              Remover vínculo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
