"use client";

/**
 * Classify-on-approve (Gabriel 2026-07-14): "Enviar para Pagamentos" opens this
 * step first — choose the tipo (aluguel / energia / aluguel e energia) and the
 * método (boleto = padrão · transferência · pix). If boleto, the Nota Fiscal is
 * MANDATORY (can't approve without it). Approving = reclassify_charge, which
 * writes the fields + clears needs_review.
 */

import * as React from "react";
import { Send } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { reclassifyCharge } from "@/app/actions/cobrancas";
import { CHARGE_KIND_UI } from "@/lib/labels";
import type { ChargeKind, PaymentMethod } from "@/lib/domain";
import type { ReviewChargeRow } from "@/app/(app)/revisao/cobrancas/queries";

const KIND_OPTIONS: ChargeKind[] = ["aluguel", "energia", "aluguel_energia"];
const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "boleto_email", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "pix", label: "Pix" },
];

/** boleto (e-mail or celular) needs a nota fiscal to be approved. */
export function isBoletoMethod(m: PaymentMethod | null | undefined): boolean {
  return m === "boleto_email" || m === "boleto_celular";
}

export function ApproveCobrancaDialog({
  row,
  onClose,
}: {
  row: ReviewChargeRow;
  onClose: () => void;
}) {
  const { run, pending } = useRunAction();
  const [kind, setKind] = React.useState<ChargeKind>(row.kind);
  // Boleto is the default; keep a pix/transferência the AI already set.
  const [method, setMethod] = React.useState<PaymentMethod>(
    row.paymentMethod === "transferencia" || row.paymentMethod === "pix"
      ? row.paymentMethod
      : "boleto_email",
  );
  const [nf, setNf] = React.useState(row.notaFiscal ?? "");
  const [dueDate, setDueDate] = React.useState(row.dueDate ?? "");

  const boleto = isBoletoMethod(method);
  const nfMissing = boleto && nf.trim() === "";

  const submit = () => {
    if (nfMissing) return;
    void run(
      () =>
        reclassifyCharge({
          chargeId: row.id,
          kind,
          paymentMethod: method,
          notaFiscal: nf.trim() || null,
          dueDate: dueDate || null,
        }),
      { success: "Enviada para Pagamentos" },
    ).then((ok) => {
      if (ok) onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar para Pagamentos</DialogTitle>
          <DialogDescription>
            Classifique a cobrança antes de aprovar. Para boleto, a nota fiscal é
            obrigatória.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ap-tipo">Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ChargeKind)}>
              <SelectTrigger id="ap-tipo" className="w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CHARGE_KIND_UI[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ap-venc">Vencimento</Label>
            <DateField id="ap-venc" value={dueDate} onValueChange={setDueDate} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ap-metodo">Método de pagamento</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="ap-metodo" className="w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {boleto ? (
            <div className="grid gap-1.5">
              <Label htmlFor="ap-nf">
                Nota fiscal <span className="text-error-emphasis">*</span>
              </Label>
              <Input
                id="ap-nf"
                value={nf}
                onChange={(e) => setNf(e.target.value)}
                placeholder="Número da nota fiscal"
                aria-invalid={nfMissing}
                className="tabular-nums"
              />
              {nfMissing ? (
                <p className="text-xs text-error-emphasis">
                  Obrigatória para boleto.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button onClick={submit} disabled={pending || nfMissing}>
            <Send className="size-4" strokeWidth={2} />
            Enviar para Pagamentos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
