"use client";

/**
 * Charge picker (shadcn `Command`) — searches OPEN charges by estação /
 * competência / chave and records a manual match. A manual match is born
 * confirmed: `record_payment` writes a `source='manual'` payment and flips the
 * charge to `pago` when covered (decision #24). Shared by the deep-dive receipt
 * cards and the review queue.
 */

import * as React from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { Loader2, Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/vammo/status-badge";
import { recordPayment } from "@/app/actions/charges";
import { CHARGE_KIND_UI, CHARGE_STATUS_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

import { fetchOpenCharges } from "./actions";
import type { OpenChargeOption, ReceiptView } from "./types";
import { Gate, paymentMethodForReceipt, useRunAction } from "./write-helpers";

function parseMoney(input: string): number | null {
  let t = input.trim();
  if (!t) return null;
  const hasComma = t.includes(",");
  const hasDot = t.includes(".");
  if (hasComma && hasDot) t = t.replace(/\./g, "").replace(",", ".");
  else if (hasComma) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toMoneyInput(value: number | null): string {
  if (value === null) return "";
  return value.toFixed(2).replace(".", ",");
}

export interface ChargePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The receipt being matched (drives default valor + payment method + value filter). */
  receipt: Pick<ReceiptView, "id" | "receiptType" | "amount" | "remaining" | "paidAt">;
  isOperator: boolean;
  /** Query keys to invalidate after a successful match. */
  invalidate?: QueryKey[];
  /** Preselect a candidate charge (review-queue candidate chip). */
  preselectChargeId?: string | null;
}

export function ChargePicker({
  open,
  onOpenChange,
  receipt,
  isOperator,
  invalidate,
  preselectChargeId,
}: ChargePickerProps) {
  const [filterByValue, setFilterByValue] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState("");
  const { run, pending } = useRunAction();

  // Valor do recibo p/ o filtro por valor (±R$0,50 no servidor). null = todas.
  const receiptValue = receipt.amount ?? receipt.remaining ?? null;
  const valueFilter = filterByValue ? receiptValue : null;

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ["comprovantes-open-charges", valueFilter],
    queryFn: () => fetchOpenCharges(valueFilter),
    enabled: open,
    staleTime: 15_000,
  });

  const selected = React.useMemo(
    () => charges.find((c) => c.id === selectedId) ?? null,
    [charges, selectedId],
  );

  // Reset transient state whenever the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setSelectedId(preselectChargeId ?? null);
      setValor("");
    }
  }, [open, preselectChargeId]);

  // Default valor = min(restante do recibo, em aberto da cobrança).
  React.useEffect(() => {
    if (!selected) return;
    const remaining = receipt.remaining;
    const openAmount = selected.openAmount;
    const candidates = [remaining, openAmount].filter(
      (n): n is number => typeof n === "number" && n > 0,
    );
    const def = candidates.length ? Math.min(...candidates) : (selected.amount ?? null);
    setValor(toMoneyInput(def));
  }, [selected, receipt.remaining]);

  function chargeLabel(c: OpenChargeOption): string {
    const station =
      c.stationId !== null
        ? `#${c.stationId}${c.stationName ? ` ${c.stationName}` : ""}`
        : "Sem estação";
    return `${station} ${CHARGE_KIND_UI[c.kind].label} ${formatCompetencia(c.competencia)} ${c.dedupeKey}`;
  }

  async function submit() {
    if (!selected) return;
    const amount = parseMoney(valor);
    if (amount === null || amount <= 0) return;
    const ok = await run(
      () =>
        recordPayment({
          chargeId: selected.id,
          receiptId: receipt.id,
          amount,
          paidAt: receipt.paidAt,
          method: paymentMethodForReceipt(receipt.receiptType),
        }),
      { success: "Comprovante vinculado", invalidate },
    );
    if (ok) onOpenChange(false);
  }

  const amountValid = (() => {
    const n = parseMoney(valor);
    return n !== null && n > 0;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conciliar comprovante</DialogTitle>
          <DialogDescription>
            Selecione a cobrança para vincular este recibo. Ao vincular, a
            cobrança é marcada como paga quando o valor é coberto.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="xs"
            variant={filterByValue ? "secondary" : "outline"}
            onClick={() => setFilterByValue((v) => !v)}
            disabled={receiptValue === null}
            title={
              filterByValue
                ? "Mostrando cobranças com valor próximo ao recibo (±R$0,50). Clique para ver todas."
                : "Mostrando todas as cobranças. Clique para filtrar pelo valor do recibo."
            }
          >
            {filterByValue ? `Valor ≈ ${formatBRL(receiptValue)}` : "Todas as cobranças"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Restante do recibo:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatBRL(receipt.remaining)}
            </span>
          </span>
        </div>

        <div className="rounded-lg border border-border">
          <Command shouldFilter>
            <CommandInput placeholder="Buscar por estação, competência, chave…" />
            <CommandList>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                  Carregando cobranças…
                </div>
              ) : (
                <>
                  <CommandEmpty>Nenhuma cobrança encontrada.</CommandEmpty>
                  <CommandGroup heading="Cobranças">
                    {charges.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={chargeLabel(c)}
                        data-checked={c.id === selectedId}
                        onSelect={() => setSelectedId(c.id)}
                        className="gap-2 py-2"
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">
                            {c.stationId !== null ? (
                              <>
                                <span className="tabular-nums">
                                  #{c.stationId}
                                </span>
                                {c.stationName ? ` — ${c.stationName}` : ""}
                              </>
                            ) : (
                              "Sem estação"
                            )}
                          </span>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <StatusBadge color={CHARGE_KIND_UI[c.kind].color}>
                              {CHARGE_KIND_UI[c.kind].label}
                            </StatusBadge>
                            <span className="tabular-nums">
                              {formatCompetencia(c.competencia)}
                            </span>
                            <span>·</span>
                            <span className="tabular-nums">
                              vence {formatDate(c.dueDate)}
                            </span>
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="text-xs font-medium tabular-nums">
                            {formatBRL(c.openAmount)}
                          </span>
                          <StatusBadge
                            color={CHARGE_STATUS_UI[c.status].color}
                            outline
                          >
                            {CHARGE_STATUS_UI[c.status].label}
                          </StatusBadge>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </div>

        {selected ? (
          <div className="flex items-end gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="conciliar-valor">Valor a alocar (R$)</Label>
              <Input
                id="conciliar-valor"
                inputMode="decimal"
                autoComplete="off"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                aria-invalid={valor.trim() !== "" && !amountValid}
                className="h-9 tabular-nums"
              />
            </div>
            <Gate isOperator={isOperator}>
              <Button
                type="button"
                onClick={submit}
                disabled={!isOperator || pending || !amountValid}
                className="h-9"
              >
                <Receipt className="size-4" strokeWidth={2} />
                Conciliar
              </Button>
            </Gate>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
