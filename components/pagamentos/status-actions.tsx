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
  setChargeDocument,
  updateChargeStatus,
} from "@/app/actions/charges";
import { adjustCharge } from "@/app/actions/alterations";
import { reclassifyCharge } from "@/app/actions/cobrancas";
import type { ChargeKind, ChargeStatus, PaymentMethod } from "@/lib/domain";
import { CHARGE_KIND_UI, CHARGE_STATUS_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/format";
import type { PagamentoRow } from "./types";
import { DocumentPicker } from "./document-picker";

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
  | { kind: "adjust" }
  | { kind: "reclassify" }
  | null;

/**
 * Safe kind targets for the inline (kind-only) reclassify, by billing-account
 * type. reclassify_charge only reattributes the account when a cadastro/
 * counterparty is supplied — which this quick dialog does NOT collect — so a
 * kind flip that would REQUIRE a different account type is unsafe here:
 *  - rent account: aluguel ↔ aluguel_energia only (both valid on a rent
 *    account); pure `energia` needs a third_party counterparty → do it in
 *    /revisão › cobranças, not here.
 *  - third_party account: any of the three (the account stays third_party).
 * The charge's CURRENT kind is always included so the select is never empty.
 */
function reclassifyKindsFor(accountType: string | null, current: ChargeKind): ChargeKind[] {
  const base: ChargeKind[] =
    accountType === "rent"
      ? ["aluguel", "aluguel_energia"]
      : ["aluguel", "aluguel_energia", "energia"];
  return base.includes(current) ? base : [current, ...base];
}

/** pt-BR money string → number, or null. */
function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

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
  // Adjust dialog fields.
  const [adjAmount, setAdjAmount] = React.useState("");
  const [adjDue, setAdjDue] = React.useState("");
  // Reclassify (tipo) dialog + document picker.
  const [reclassKind, setReclassKind] = React.useState<ChargeKind>(row.kind);
  const [docPickerOpen, setDocPickerOpen] = React.useState(false);

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
    setAdjAmount("");
    setAdjDue("");
  }

  function openAdjust() {
    setAdjAmount(row.amount != null ? String(row.amount) : "");
    setAdjDue("");
    setReason("");
    setMode({ kind: "adjust" });
  }

  function runAdjust() {
    if (!uuid) return;
    const newAmount = parseMoney(adjAmount);
    startTransition(async () => {
      const res = await adjustCharge({
        chargeId: uuid,
        newAmount: newAmount,
        newDueDate: adjDue || null,
        reason: reason.trim(),
      });
      if (res.ok) {
        toast.success("Cobrança ajustada.");
        close();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function openReclassify() {
    setReclassKind(row.kind);
    setReason("");
    setMode({ kind: "reclassify" });
  }

  function runReclassify() {
    if (!uuid) return;
    startTransition(async () => {
      const res = await reclassifyCharge({
        chargeId: uuid,
        kind: reclassKind,
        notes: reason.trim() || null,
      });
      if (res.ok) {
        toast.success("Cobrança reclassificada.");
        close();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function runUnbindDocument() {
    if (!uuid) return;
    startTransition(async () => {
      const res = await setChargeDocument({ chargeId: uuid, documentId: null });
      if (res.ok) {
        toast.success("Documento desvinculado.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
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

  // adjust_charge refuses pago; everything else may be re-priced / re-dated
  const canAdjust = !isTerminal;
  // Reclassify (tipo) is for rent / third-party charges only: reclassify_charge
  // routes energia to a third_party account, so running it on an Enel/EDP row
  // would wrongly move it off its concessionária account; and an UNIDENTIFIED
  // row (no account) has nothing to reattribute — flipping its kind would just
  // strip it from the review queue. It also refuses pago / charges with payments.
  const canReclassify =
    (row.accountType === "rent" || row.accountType === "third_party") &&
    !isTerminal &&
    !isConciliado;
  const reclassKinds = reclassifyKindsFor(row.accountType, row.kind);
  // Whether any "edit" action precedes the document section (drives the divider).
  const hasEditActions = isConciliado || canPay || canAdjust || canReclassify;
  // Document binding is always offered (any charge can set/clear its source
  // bill), so the menu is never empty once it is enabled.
  const nothingToDo = false;

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
              Registrar pagamento…
            </DropdownMenuItem>
          ) : null}
          {canAdjust ? (
            <DropdownMenuItem onClick={openAdjust}>
              Ajustar valor/vencimento…
            </DropdownMenuItem>
          ) : null}
          {canReclassify ? (
            <DropdownMenuItem onClick={openReclassify}>
              Reclassificar tipo…
            </DropdownMenuItem>
          ) : null}
          {hasEditActions ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={() => setDocPickerOpen(true)}>
            Vincular documento…
          </DropdownMenuItem>
          {row.sourceDocumentId ? (
            <DropdownMenuItem onClick={runUnbindDocument}>
              Desvincular documento
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

      {/* Registrar pagamento (record_payment). Sem comprovante vinculado NÃO
          marca como pago — apenas registra o pagamento; a baixa (Pago) exige
          um comprovante vinculado em /comprovantes. */}
      <Dialog open={mode?.kind === "pago"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              Registra um pagamento de {formatBRL(row.amount)} para esta
              cobrança. Ela só é marcada como <strong>Pago</strong> quando há um
              comprovante vinculado (em /comprovantes) — este registro sozinho
              não dá baixa.
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

      {/* Ajuste de valor/vencimento (adjust_charge — pró-rata / dívida adiada) */}
      <Dialog open={mode?.kind === "adjust"} onOpenChange={(o) => (o ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar cobrança</DialogTitle>
            <DialogDescription>
              Novo valor e/ou vencimento (pró-rata, dívida adiada). O motivo fica
              no histórico e a cobrança é marcada como ajustada.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="adj-valor">Novo valor</Label>
              <Input
                id="adj-valor"
                inputMode="decimal"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder={row.amount != null ? formatBRL(row.amount) : "0,00"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adj-venc">Novo vencimento</Label>
              <Input
                id="adj-venc"
                type="date"
                value={adjDue}
                onChange={(e) => setAdjDue(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adj-reason">Motivo</Label>
              <Textarea
                id="adj-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: pró-rata de instalação, renegociação de dívida…"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              onClick={runAdjust}
              disabled={
                pending ||
                !reason.trim() ||
                (parseMoney(adjAmount) === null && !adjDue)
              }
            >
              Salvar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reclassificar tipo (reclassify_charge — kind-only patch, Locação) */}
      <Dialog
        open={mode?.kind === "reclassify"}
        onOpenChange={(o) => (o ? null : close())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reclassificar cobrança</DialogTitle>
            <DialogDescription>
              Ajusta o tipo desta cobrança. A alteração fica no histórico com o
              seu nome. Só é possível em cobranças ainda em aberto (sem
              pagamento).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="reclass-tipo">Tipo</Label>
              <Select
                value={reclassKind}
                onValueChange={(v) => setReclassKind(v as ChargeKind)}
              >
                <SelectTrigger id="reclass-tipo" className="w-full bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reclassKinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHARGE_KIND_UI[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reclass-reason">Observação (opcional)</Label>
              <Textarea
                id="reclass-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: a cobrança também inclui energia…"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              onClick={runReclassify}
              disabled={pending || reclassKind === row.kind}
            >
              Reclassificar
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

      {/* Vincular documento de origem (set_charge_document) */}
      {uuid ? (
        <DocumentPicker
          open={docPickerOpen}
          onOpenChange={setDocPickerOpen}
          chargeId={uuid}
        />
      ) : null}
    </div>
  );
}
