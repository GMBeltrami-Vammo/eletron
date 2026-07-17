"use client";

/**
 * "Nova cobrança manual" (feature A + Enel/EDP fatura, decisão #63) — create a
 * single charge by hand from /pagamentos.
 *  - Aluguel / Energia / Aluguel e energia → station-only via create_manual_charge
 *    (no contract needed); the row can be edited/attributed later.
 *  - Enel / EDP → a real energy FATURA via createManualBill: pick the installation
 *    (existing account), competência + vencimento + valor + método (DA/Boleto) +
 *    the PDF. The PDF goes to the scraper bills folder as
 *    `Fatura-Enel-{instalação}-{AAAA-MM}.pdf`; método sets the per-bill DA fact
 *    that drives the fiscal column B (#42). Enel/EDP is offered only in the
 *    standalone dialog (not the add-to-document controlled mode).
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
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadDropzone, type UploadItem } from "@/components/vammo/upload-dropzone";
import { createManualCharge } from "@/app/actions/charges";
import { createManualBill } from "@/app/actions/comprovantes";
import type { ChargeKind, PaymentMethod } from "@/lib/domain";
import { CHARGE_KIND_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

import type { EnergyAccountOption } from "@/components/energia/types";
import type { StationOption } from "./types";

const KIND_OPTIONS: ChargeKind[] = ["aluguel", "energia", "aluguel_energia"];
const MAX_PDF_BYTES = 25_000_000;

/** UI tipo — the 3 ChargeKinds plus the two energy-fatura providers. */
type NovaTipo = ChargeKind | "enel" | "edp";

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
  energyAccounts = [],
  documentId = null,
  defaultCompetencia,
  defaultStationId = null,
  open: controlledOpen,
  onOpenChange,
}: {
  canWrite: boolean;
  stations: StationOption[];
  /** Enel/EDP accounts for the fatura branch (empty in sheets/dev). */
  energyAccounts?: EnergyAccountOption[];
  /** Bind the created charge to this source document (e.g. add a missing ND line). */
  documentId?: string | null;
  /** 'YYYY-MM' — seeds competência when opened (e.g. the document's month). */
  defaultCompetencia?: string;
  defaultStationId?: number | null;
  /** Controlled mode: when onOpenChange is provided, the internal trigger button
   *  is hidden and the parent drives visibility (used to add to a document). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const controlled = onOpenChange !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlled ? (controlledOpen ?? false) : internalOpen;
  const setOpen = controlled ? onOpenChange : setInternalOpen;
  const [pending, startTransition] = React.useTransition();
  const [submitting, setSubmitting] = React.useState(false);

  const [tipo, setTipo] = React.useState<NovaTipo>("aluguel");
  const [stationId, setStationId] = React.useState<number | null>(defaultStationId);
  const [stationPickerOpen, setStationPickerOpen] = React.useState(false);
  const [competencia, setCompetencia] = React.useState(
    defaultCompetencia ?? currentMonth(),
  );
  const [dueDate, setDueDate] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [method, setMethod] = React.useState<string>("");

  // Fatura (Enel/EDP) branch state.
  const [accountId, setAccountId] = React.useState("");
  const [accountPickerOpen, setAccountPickerOpen] = React.useState(false);
  const [metodo, setMetodo] = React.useState<"" | "da" | "boleto">("");
  const [nf, setNf] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [items, setItems] = React.useState<UploadItem[]>([]);

  // Enel/EDP is a real fatura (needs a PDF + installation); only offered in the
  // standalone dialog, never the add-to-document controlled mode.
  const faturaEnabled = !controlled && energyAccounts.length > 0;
  const isFatura = tipo === "enel" || tipo === "edp";
  const provider = tipo === "enel" ? "energy_enel" : "energy_edp";
  const providerAccounts = React.useMemo(
    () => energyAccounts.filter((a) => a.provider === provider),
    [energyAccounts, provider],
  );
  const selectedAccount = providerAccounts.find((a) => a.id === accountId) ?? null;

  function reset() {
    setTipo("aluguel");
    setStationId(defaultStationId);
    setCompetencia(defaultCompetencia ?? currentMonth());
    setDueDate("");
    setValor("");
    setMethod("");
    setAccountId("");
    setMetodo("");
    setNf("");
    setFile(null);
    setItems([]);
  }

  function onFiles(files: File[]) {
    const picked = files[0] ?? null;
    if (!picked) return;
    setFile(picked);
    setItems([
      {
        id: `${picked.name}-${picked.size}`,
        file: picked,
        state:
          picked.size > MAX_PDF_BYTES
            ? { status: "error", message: "acima de 25 MB" }
            : { status: "done", message: "pronto para enviar" },
      },
    ]);
  }

  const selectedStation = stations.find((s) => s.id === stationId) ?? null;
  const amount = parseMoney(valor);

  const genericValid =
    stationId !== null && competencia !== "" && amount !== null && amount > 0;
  const faturaValid =
    accountId !== "" &&
    competencia !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
    amount !== null &&
    amount > 0 &&
    metodo !== "" &&
    file !== null &&
    file.size <= MAX_PDF_BYTES;
  const valid = isFatura ? faturaValid : genericValid;
  const busy = pending || submitting;

  function submitGeneric() {
    if (!genericValid || stationId === null || amount === null) return;
    startTransition(async () => {
      const res = await createManualCharge({
        kind: tipo as ChargeKind,
        stationId,
        competencia,
        amount,
        dueDate: dueDate || null,
        paymentMethod: (method || null) as PaymentMethod | null,
        documentId,
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

  async function submitFatura() {
    if (!faturaValid || !file) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("billingAccountId", accountId);
      fd.append("value", valor);
      fd.append("dueDate", dueDate);
      fd.append("competencia", competencia);
      fd.append("metodo", metodo);
      if (nf.trim()) fd.append("nf", nf.trim());

      const res = await createManualBill(fd);
      if (res.ok) {
        toast.success(
          res.data.possibleDuplicate
            ? "Fatura criada — possível duplicata no Drive, confira."
            : "Fatura criada.",
        );
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar a fatura");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canWrite) {
    if (controlled) return null; // parent gates it; nothing to render
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
      {controlled ? null : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <CirclePlus className="size-4" strokeWidth={2} />
          Nova cobrança
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova cobrança manual</DialogTitle>
            <DialogDescription>
              {isFatura
                ? "Lança uma fatura de energia (Enel/EDP) com o PDF. Vai para a pasta do scraper e vira uma cobrança."
                : "Cria uma cobrança avulsa de aluguel ou energia para uma estação. Você pode vincular um documento e editar depois na lista."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nc-tipo">Tipo</Label>
              <Select
                value={tipo}
                onValueChange={(v) => {
                  setTipo(v as NovaTipo);
                  setAccountId("");
                }}
              >
                <SelectTrigger id="nc-tipo" className="w-full bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHARGE_KIND_UI[k].label}
                    </SelectItem>
                  ))}
                  {faturaEnabled ? (
                    <>
                      <SelectItem value="enel">Enel (fatura)</SelectItem>
                      <SelectItem value="edp">EDP (fatura)</SelectItem>
                    </>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            {isFatura ? (
              <>
                <div className="grid gap-1.5">
                  <Label>Instalação ({tipo === "enel" ? "Enel" : "EDP"})</Label>
                  <Popover open={accountPickerOpen} onOpenChange={setAccountPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          className="w-full justify-between bg-card font-normal"
                        />
                      }
                    >
                      {selectedAccount ? (
                        <span className="truncate tabular-nums">
                          {selectedAccount.installationKey}
                          {selectedAccount.stationId !== null
                            ? ` — estação ${selectedAccount.stationId}`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Selecione a instalação…
                        </span>
                      )}
                      <ChevronsUpDown className="size-4 opacity-50" strokeWidth={2} />
                    </PopoverTrigger>
                    <PopoverContent className="w-[--anchor-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Instalação, estação…" />
                        <CommandList>
                          <CommandEmpty>Nenhuma instalação.</CommandEmpty>
                          {providerAccounts.map((a) => (
                            <CommandItem
                              key={a.id}
                              value={`${a.installationKey} ${a.stationId ?? ""} ${a.stationName ?? ""}`}
                              onSelect={() => {
                                setAccountId(a.id);
                                setAccountPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "size-4",
                                  a.id === accountId ? "opacity-100" : "opacity-0",
                                )}
                                strokeWidth={2}
                              />
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate tabular-nums">
                                  {a.installationKey}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {a.stationId !== null
                                    ? `Estação ${a.stationId}`
                                    : "Sem estação"}
                                  {a.stationName ? ` — ${a.stationName}` : ""}
                                </span>
                              </span>
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
                    <Label htmlFor="nc-venc">Vencimento</Label>
                    <DateField id="nc-venc" value={dueDate} onValueChange={setDueDate} />
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
                    <Label htmlFor="nc-metodo-da">Método</Label>
                    <Select
                      value={metodo}
                      onValueChange={(v) => setMetodo(v as "da" | "boleto")}
                    >
                      <SelectTrigger id="nc-metodo-da" className="w-full bg-card">
                        <SelectValue placeholder="DA ou Boleto" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="da">Débito automático</SelectItem>
                        <SelectItem value="boleto">Boleto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="nc-nf">
                    Nota fiscal{" "}
                    <span className="font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <Input
                    id="nc-nf"
                    value={nf}
                    onChange={(e) => setNf(e.target.value)}
                    className="tabular-nums"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label>PDF da fatura</Label>
                  <UploadDropzone
                    accept="application/pdf"
                    maxBytes={MAX_PDF_BYTES}
                    items={items}
                    onFiles={onFiles}
                    disabled={submitting}
                    hint="PDF obrigatório · até 25 MB"
                  />
                </div>
              </>
            ) : (
              <>
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
                    <DateField id="nc-venc" value={dueDate} onValueChange={setDueDate} />
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
              </>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              onClick={isFatura ? submitFatura : submitGeneric}
              disabled={busy || !valid}
            >
              {isFatura ? "Criar fatura" : "Criar cobrança"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
