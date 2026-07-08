"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmCharge,
  recordPayment,
  updateChargeStatus,
} from "@/app/actions/charges";
import type { ChargeStatus, PaymentMethod } from "@/lib/domain";
import { CHARGE_STATUS_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/format";
import type { PagamentoRow } from "./types";

/** update_charge_status targets (never pago/conciliado/atrasado — RPC forbids). */
const STATUS_TARGETS: { status: ChargeStatus; adminOnly?: boolean }[] = [
  { status: "boleto_recebido" },
  { status: "em_compensacao" },
  { status: "negociada" },
  { status: "pendente" },
  { status: "nao_aplicavel" },
  { status: "cancelada", adminOnly: true },
];

const TODAY = (): string => new Date().toISOString().slice(0, 10);

type DialogMode =
  | { kind: "status"; target: ChargeStatus }
  | { kind: "pago" }
  | { kind: "confirm" }
  | null;

export function StatusActions({
  row,
  canWrite,
  isAdmin,
}: {
  row: PagamentoRow;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<DialogMode>(null);
  const [pending, startTransition] = React.useTransition();

  // Pago dialog fields.
  const [paidAt, setPaidAt] = React.useState(TODAY);
  const [method, setMethod] = React.useState<string>("");
  // Status dialog reason.
  const [reason, setReason] = React.useState("");

  const uuid = row.chargeUuid;
  const disabledReason = !canWrite
    ? "Requer papel operador/admin"
    : uuid === null
      ? "Indisponível — requer o backend Supabase"
      : null;

  const isConciliado = row.status === "conciliado";
  const isTerminal = row.status === "pago";
  const canPay =
    !isTerminal &&
    !isConciliado &&
    row.status !== "cancelada" &&
    row.status !== "nao_aplicavel" &&
    row.amount !== null &&
    row.amount > 0;

  const availableTargets = STATUS_TARGETS.filter(
    (t) =>
      t.status !== row.status &&
      (!t.adminOnly || isAdmin) &&
      !isTerminal &&
      !isConciliado,
  );

  function close() {
    setMode(null);
    setReason("");
    setMethod("");
    setPaidAt(TODAY());
  }

  function runStatus(target: ChargeStatus) {
    if (!uuid) return;
    startTransition(async () => {
      const res = await updateChargeStatus({
        chargeId: uuid,
        newStatus: target,
        reason: reason.trim() || `Alterado para ${CHARGE_STATUS_UI[target].label}`,
      });
      if (res.ok) {
        toast.success(`Cobrança marcada como ${CHARGE_STATUS_UI[target].label}.`);
        close();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function runPago() {
    if (!uuid || row.amount === null) return;
    startTransition(async () => {
      const res = await recordPayment({
        chargeId: uuid,
        amount: row.amount as number,
        paidAt: paidAt || null,
        method: (method || null) as PaymentMethod | null,
      });
      if (res.ok) {
        toast.success("Pagamento registrado.");
        close();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function runConfirm() {
    if (!uuid) return;
    startTransition(async () => {
      const res = await confirmCharge({ chargeId: uuid });
      if (res.ok) {
        toast.success("Cobrança confirmada como paga.");
        close();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (disabledReason) {
    return (
      <div className="flex justify-end">
        <span title={disabledReason}>
          <Button variant="ghost" size="icon-sm" disabled aria-label="Ações">
            <MoreHorizontal className="size-4" strokeWidth={2} />
          </Button>
        </span>
      </div>
    );
  }

  const nothingToDo =
    !canPay && !isConciliado && availableTargets.length === 0;

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}
          disabled={nothingToDo}
        >
          <MoreHorizontal className="size-4" strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel>Ações da cobrança</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isConciliado ? (
            <DropdownMenuItem onClick={() => setMode({ kind: "confirm" })}>
              Confirmar pagamento
            </DropdownMenuItem>
          ) : null}
          {canPay ? (
            <DropdownMenuItem onClick={() => setMode({ kind: "pago" })}>
              Marcar como pago…
            </DropdownMenuItem>
          ) : null}
          {availableTargets.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {availableTargets.map((t) => (
                <DropdownMenuItem
                  key={t.status}
                  variant={t.status === "cancelada" ? "destructive" : "default"}
                  onClick={() => setMode({ kind: "status", target: t.status })}
                >
                  {CHARGE_STATUS_UI[t.status].label}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirm (conciliado → pago) */}
      <Dialog
        open={mode?.kind === "confirm"}
        onOpenChange={(o) => (o ? null : close())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
            <DialogDescription>
              A cobrança foi conciliada automaticamente e aguarda confirmação de
              uma pessoa. Confirmar marca como <strong>Pago</strong> com o seu
              nome no histórico.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={runConfirm} disabled={pending}>
              Confirmar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Marcar como pago (record_payment, sem comprovante) */}
      <Dialog open={mode?.kind === "pago"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              Registra um pagamento de {formatBRL(row.amount)} para esta
              cobrança. O vínculo com comprovante é feito em /comprovantes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pago-data">Data do pagamento</Label>
              <Input
                id="pago-data"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pago-metodo">Método (opcional)</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as string)}>
                <SelectTrigger id="pago-metodo" className="w-full bg-card">
                  <SelectValue placeholder="Não informar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Não informar</SelectItem>
                  {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map(
                    (m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={runPago} disabled={pending || row.amount === null}>
              Registrar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mudança de status (update_charge_status) */}
      <Dialog
        open={mode?.kind === "status"}
        onOpenChange={(o) => (o ? null : close())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Marcar como{" "}
              {mode?.kind === "status"
                ? CHARGE_STATUS_UI[mode.target].label
                : ""}
            </DialogTitle>
            <DialogDescription>
              A alteração fica registrada no histórico com o seu nome.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="status-reason">Motivo (opcional)</Label>
            <Textarea
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: negociado com o locador…"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              variant={
                mode?.kind === "status" && mode.target === "cancelada"
                  ? "destructive"
                  : "default"
              }
              onClick={() => mode?.kind === "status" && runStatus(mode.target)}
              disabled={pending}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
