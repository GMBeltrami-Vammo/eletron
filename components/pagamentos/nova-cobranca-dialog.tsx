"use client";

/**
 * "Nova cobrança manual" (feature A) — create a single Energia/Aluguel charge by
 * hand to fix minor issues: manual station + payment method + valor + competência
 * (+ optional vencimento). Station-only (no contract needed) via
 * create_manual_charge; the row can later be edited/attributed or have a
 * document bound from /pagamentos.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createManualCharge } from "@/app/actions/charges";
import type { ChargeKind, PaymentMethod } from "@/lib/domain";
import { CHARGE_KIND_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

import type { StationOption } from "./types";

const KIND_OPTIONS: ChargeKind[] = ["aluguel", "energia", "aluguel_energia"];

function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const n = Number(
    t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t,
  );
  return Number.isFinite(n) ? n : null;
}

/** Current month 'YYYY-MM' without relying on Date.now at module scope. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function NovaCobrancaDialog({
  canWrite,
  stations,
}: {
  canWrite: boolean;
  stations: StationOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const [kind, setKind] = React.useState<ChargeKind>("aluguel");
  const [stationId, setStationId] = React.useState<number | null>(null);
  const [stationPickerOpen, setStationPickerOpen] = React.useState(false);
  const [competencia, setCompetencia] = React.useState(currentMonth);
  const [dueDate, setDueDate] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [method, setMethod] = React.useState<string>("");

  function reset() {
    setKind("aluguel");
    setStationId(null);
    setCompetencia(currentMonth());
    setDueDate("");
    setValor("");
    setMethod("");
  }

  const selectedStation = stations.find((s) => s.id === stationId) ?? null;
  const amount = parseMoney(valor);
  const valid = stationId !== null && competencia !== "" && amount !== null && amount > 0;

  function submit() {
    if (!valid || stationId === null || amount === null) return;
    startTransition(async () => {
      const res = await createManualCharge({
        kind,
        stationId,
        competencia,
        amount,
        dueDate: dueDate || null,
        paymentMethod: (method || null) as PaymentMethod | null,
      });
      if (res.ok) {
        toast.success("Cobrança criada.");
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!canWrite) {
    return (
      <span title="Requer papel operador/admin">
        <Button variant="outline" disabled>
          <CirclePlus className="size-4" strokeWidth={2} />
          Nova cobrança
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CirclePlus className="size-4" strokeWidth={2} />
        Nova cobrança
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova cobrança manual</DialogTitle>
            <DialogDescription>
              Cria uma cobrança avulsa de aluguel ou energia para uma estação.
              Você pode vincular um documento e editar depois na lista.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nc-tipo">Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ChargeKind)}>
                <SelectTrigger id="nc-tipo" className="w-full bg-card">
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
              <Label>Estação</Label>
              <Popover open={stationPickerOpen} onOpenChange={setStationPickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between bg-card font-normal"
                    />
                  }
                >
                  {selectedStation ? (
                    <span className="truncate">
                      <span className="tabular-nums">#{selectedStation.id}</span>
                      {selectedStation.name ? ` — ${selectedStation.name}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Selecione a estação…
                    </span>
                  )}
                  <ChevronsUpDown className="size-4 opacity-50" strokeWidth={2} />
                </PopoverTrigger>
                <PopoverContent className="w-[--anchor-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar estação por nº ou nome…" />
                    <CommandList>
                      <CommandEmpty>Nenhuma estação.</CommandEmpty>
                      {stations.map((s) => (
                        <CommandItem
                          key={s.id}
                          value={`${s.id} ${s.name ?? ""}`}
                          onSelect={() => {
                            setStationId(s.id);
                            setStationPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "size-4",
                              s.id === stationId ? "opacity-100" : "opacity-0",
                            )}
                            strokeWidth={2}
                          />
                          <span className="tabular-nums">#{s.id}</span>
                          {s.name ? (
                            <span className="truncate text-muted-foreground">
                              {s.name}
                            </span>
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nc-comp">Competência</Label>
                <Input
                  id="nc-comp"
                  type="month"
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nc-venc">Vencimento (opcional)</Label>
                <Input
                  id="nc-venc"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nc-valor">Valor</Label>
                <Input
                  id="nc-valor"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  className="tabular-nums"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nc-metodo">Método (opcional)</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as string)}>
                  <SelectTrigger id="nc-metodo" className="w-full bg-card">
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
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={submit} disabled={pending || !valid}>
              Criar cobrança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
