"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  CircleCheck,
  ExternalLink,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { createManualBill } from "@/app/actions/comprovantes";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/vammo/status-badge";
import { UploadDropzone, type UploadItem } from "@/components/vammo/upload-dropzone";
import { ACCOUNT_TYPE_UI } from "@/lib/labels";

import type { EnergyAccountOption } from "./types";

const MAX_PDF_BYTES = 25_000_000;

/** Result shape of `createManualBill` (mirrors ManualBillUploadResult). */
interface ManualBillResult {
  chargeId: string;
  documentId: string;
  webViewLink: string;
  possibleDuplicate: boolean;
  warnings: string[];
}

/** pt-BR money → number (client-side pre-flight; server re-parses). */
function parseBrMoneyClient(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const normalized = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** `MM/AAAA` → `YYYY-MM`, or null when blank/invalid. */
function competenciaToIso(raw: string): string | null {
  const m = raw.trim().match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
}

const schema = z.object({
  accountId: z.string().min(1, "Selecione a conta"),
  valor: z
    .string()
    .refine((v) => {
      const n = parseBrMoneyClient(v);
      return n !== null && n > 0;
    }, "Informe um valor maior que zero"),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o vencimento"),
  competencia: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^(0[1-9]|1[0-2])\/\d{4}$/.test(v),
      "Use o formato MM/AAAA",
    ),
});

function accountLabel(a: EnergyAccountOption): string {
  const prov = ACCOUNT_TYPE_UI[a.provider].label;
  const est = a.stationId !== null ? `estação ${a.stationId}` : "sem estação";
  return `${prov} · ${a.installationKey} · ${est}`;
}

export function ManualBillDialog({
  accounts,
  canWrite,
  presetAccountId,
}: {
  accounts: EnergyAccountOption[];
  canWrite: boolean;
  presetAccountId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const disabledReason = !canWrite
    ? "Requer papel operador"
    : accounts.length === 0
      ? "Disponível com o banco charging (fase 2)"
      : null;

  if (disabledReason) {
    return (
      <span title={disabledReason} className="inline-block">
        <Button size="sm" className="h-9" disabled>
          <Plus className="size-4" strokeWidth={2} />
          Adicionar fatura manual
        </Button>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="h-9" />}>
        <Plus className="size-4" strokeWidth={2} />
        Adicionar fatura manual
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <ManualBillForm
          accounts={accounts}
          presetAccountId={presetAccountId}
          onDone={() => router.refresh()}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ManualBillForm({
  accounts,
  presetAccountId,
  onDone,
  onClose,
}: {
  accounts: EnergyAccountOption[];
  presetAccountId?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = React.useState(presetAccountId ?? "");
  const [accountOpen, setAccountOpen] = React.useState(false);
  const [competencia, setCompetencia] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [vencimento, setVencimento] = React.useState("");
  const [nf, setNf] = React.useState("");
  const [notas, setNotas] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<ManualBillResult | null>(null);

  const enel = accounts.filter((a) => a.provider === "energy_enel");
  const edp = accounts.filter((a) => a.provider === "energy_edp");
  const selected = accounts.find((a) => a.id === accountId) ?? null;

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
    setErrors((e) => ({ ...e, file: "" }));
  }

  function resetForm() {
    setAccountId(presetAccountId ?? "");
    setCompetencia("");
    setValor("");
    setVencimento("");
    setNf("");
    setNotas("");
    setFile(null);
    setItems([]);
    setErrors({});
    setResult(null);
  }

  async function onSubmit() {
    const parsed = schema.safeParse({ accountId, valor, vencimento, competencia });
    const errs: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errs[key]) errs[key] = issue.message;
      }
    }
    if (!file) errs.file = "PDF da fatura é obrigatório";
    else if (file.size > MAX_PDF_BYTES) errs.file = "PDF acima de 25 MB";
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !file) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("billingAccountId", accountId);
      fd.append("value", valor);
      fd.append("dueDate", vencimento);
      const compIso = competenciaToIso(competencia);
      if (compIso) fd.append("competencia", compIso);
      if (nf.trim()) fd.append("nf", nf.trim());
      if (notas.trim()) fd.append("notes", notas.trim());

      const res = await createManualBill(fd);
      if (!res.ok) {
        toast.error("Não foi possível registrar a fatura", {
          description: res.error,
        });
        return;
      }
      setResult(res.data);
      toast.success("Fatura registrada");
      onDone();
    } catch (err) {
      toast.error("Falha ao registrar a fatura", {
        description: err instanceof Error ? err.message : "erro inesperado",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleCheck className="size-5 text-success-emphasis" strokeWidth={2} />
            Fatura registrada
          </DialogTitle>
          <DialogDescription>
            A cobrança foi criada e o PDF salvo no Drive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge color="grey" outline>
              Manual
            </StatusBadge>
            {result.webViewLink ? (
              <a
                href={result.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-info-emphasis underline-offset-2 hover:underline"
              >
                Ver PDF no Drive
                <ExternalLink className="size-3.5" strokeWidth={2} />
              </a>
            ) : null}
          </div>

          {result.possibleDuplicate ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning-subtle/40 p-2.5 text-xs text-warning-emphasis">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
              Possível duplicata — já existia um PDF com este nome no Drive;
              confira se a fatura não foi lançada antes.
            </p>
          ) : null}

          {result.warnings.length > 0 ? (
            <ul className="space-y-0.5 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetForm}>
            Registrar outra
          </Button>
          <DialogClose render={<Button />}>Fechar</DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adicionar fatura manual</DialogTitle>
        <DialogDescription>
          Lança uma fatura de energia (Enel/EDP) com o PDF. Vai para a planilha
          do scraper e vira uma cobrança.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {/* Conta */}
        <div className="space-y-1.5">
          <Label>Conta</Label>
          <Popover open={accountOpen} onOpenChange={setAccountOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="w-full justify-between px-3 font-normal"
                />
              }
            >
              {selected ? (
                <span className="truncate text-left">{accountLabel(selected)}</span>
              ) : (
                <span className="text-muted-foreground">Escolher conta…</span>
              )}
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" strokeWidth={2} />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(24rem,calc(100vw-3rem))] p-0"
            >
              <Command>
                <CommandInput placeholder="Instalação, estação…" />
                <CommandList>
                  <CommandEmpty>Nenhuma conta encontrada.</CommandEmpty>
                  {enel.length > 0 ? (
                    <CommandGroup heading="Enel">
                      {enel.map((a) => (
                        <AccountItem
                          key={a.id}
                          account={a}
                          selected={a.id === accountId}
                          onSelect={() => {
                            setAccountId(a.id);
                            setAccountOpen(false);
                            setErrors((e) => ({ ...e, accountId: "" }));
                          }}
                        />
                      ))}
                    </CommandGroup>
                  ) : null}
                  {edp.length > 0 ? (
                    <CommandGroup heading="EDP">
                      {edp.map((a) => (
                        <AccountItem
                          key={a.id}
                          account={a}
                          selected={a.id === accountId}
                          onSelect={() => {
                            setAccountId(a.id);
                            setAccountOpen(false);
                            setErrors((e) => ({ ...e, accountId: "" }));
                          }}
                        />
                      ))}
                    </CommandGroup>
                  ) : null}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {errors.accountId ? (
            <p className="text-xs text-destructive">{errors.accountId}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Competência */}
          <div className="space-y-1.5">
            <Label htmlFor="mb-competencia">
              Competência{" "}
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="mb-competencia"
              inputMode="numeric"
              placeholder="MM/AAAA"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              aria-invalid={Boolean(errors.competencia)}
              className="tabular-nums"
            />
            {errors.competencia ? (
              <p className="text-xs text-destructive">{errors.competencia}</p>
            ) : null}
          </div>

          {/* Vencimento */}
          <div className="space-y-1.5">
            <Label htmlFor="mb-vencimento">Vencimento</Label>
            <DateField
              id="mb-vencimento"
              value={vencimento}
              onValueChange={setVencimento}
              invalid={Boolean(errors.vencimento)}
              className="tabular-nums"
            />
            {errors.vencimento ? (
              <p className="text-xs text-destructive">{errors.vencimento}</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Valor */}
          <div className="space-y-1.5">
            <Label htmlFor="mb-valor">Valor</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <Input
                id="mb-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                aria-invalid={Boolean(errors.valor)}
                className="pl-9 tabular-nums"
              />
            </div>
            {errors.valor ? (
              <p className="text-xs text-destructive">{errors.valor}</p>
            ) : null}
          </div>

          {/* NF */}
          <div className="space-y-1.5">
            <Label htmlFor="mb-nf">
              NF / Nº doc.{" "}
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="mb-nf"
              value={nf}
              onChange={(e) => setNf(e.target.value)}
              className="tabular-nums"
            />
          </div>
        </div>

        {/* PDF */}
        <div className="space-y-1.5">
          <Label>PDF da fatura</Label>
          <UploadDropzone
            accept="application/pdf"
            maxBytes={MAX_PDF_BYTES}
            items={items}
            onFiles={onFiles}
            disabled={submitting}
            hint="PDF obrigatório · até 25 MB"
          />
          {errors.file ? (
            <p className="text-xs text-destructive">{errors.file}</p>
          ) : null}
        </div>

        {/* Notas */}
        <div className="space-y-1.5">
          <Label htmlFor="mb-notas">
            Notas{" "}
            <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="mb-notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Observações internas…"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Enviando…" : "Registrar fatura"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AccountItem({
  account,
  selected,
  onSelect,
}: {
  account: EnergyAccountOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`${account.installationKey} ${account.stationId ?? ""} ${account.stationName ?? ""}`}
      data-checked={selected}
      onSelect={onSelect}
      className="py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium tabular-nums">
          {account.installationKey}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {account.stationId !== null
            ? `Estação ${account.stationId}`
            : "Sem estação"}
          {account.stationName ? ` — ${account.stationName}` : ""}
        </span>
      </div>
    </CommandItem>
  );
}
