"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarPlus, CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { gerarMes } from "@/app/actions/charges";
import { CONTRACT_TYPE_UI } from "@/lib/labels";
import { formatBRL, formatCompetencia } from "@/lib/format";
import { cn } from "@/lib/utils";
import { previewGerarMes } from "./gerar-mes-actions";
import { FlagBadges } from "./flag-badges";
import type { GerarMesProjection } from "./gerar-mes-types";

/** current-month-first list of `YYYY-MM-01` options (next month … 6 months back). */
function buildMonthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const opts: { value: string; label: string }[] = [];
  for (let delta = 1; delta >= -6; delta--) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + delta, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    opts.push({ value, label: formatCompetencia(value) });
  }
  return opts;
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function GerarMesDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const monthOptions = React.useMemo(buildMonthOptions, []);
  const [open, setOpen] = React.useState(false);
  const [competencia, setCompetencia] = React.useState(currentMonthValue);
  const [projection, setProjection] = React.useState<GerarMesProjection | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [previewPending, startPreview] = React.useTransition();
  const [confirmPending, startConfirm] = React.useTransition();

  function reset() {
    setProjection(null);
    setError(null);
  }

  function onMonthChange(value: string) {
    setCompetencia(value);
    reset();
  }

  function doPreview() {
    setError(null);
    startPreview(async () => {
      const res = await previewGerarMes({ competencia });
      if (res.ok) setProjection(res.data);
      else {
        setProjection(null);
        setError(res.error);
      }
    });
  }

  function doConfirm() {
    startConfirm(async () => {
      const res = await gerarMes({ competencia });
      if (res.ok) {
        toast.success(
          `${res.data.created} criada(s), ${res.data.skipped_existing} já existia(m).`,
        );
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
        <Button disabled>
          <CalendarPlus className="size-4" strokeWidth={2} />
          Gerar mês
        </Button>
      </span>
    );
  }

  const monthLabel = formatCompetencia(competencia);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlus className="size-4" strokeWidth={2} />
        Gerar mês
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Gerar cobranças do mês</DialogTitle>
            <DialogDescription>
              Prévia das cobranças de aluguel para o mês escolhido, calculada
              sobre os contratos ativos (Pix/Transferência) e os boxes ativos.
              Nada é criado até você confirmar.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Competência
              </label>
              <Select
                value={competencia}
                onValueChange={(v) => onMonthChange(v as string)}
              >
                <SelectTrigger className="w-44 bg-card">
                  <SelectValue>{monthLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={doPreview}
              disabled={previewPending}
            >
              {previewPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : null}
              Gerar prévia
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert strokeWidth={2} />
              <AlertTitle>Não foi possível gerar a prévia</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {projection ? (
            <ProjectionView projection={projection} monthLabel={monthLabel} />
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
            <Button
              onClick={doConfirm}
              disabled={
                !projection ||
                projection.toCreateCount === 0 ||
                confirmPending ||
                previewPending
              }
            >
              {confirmPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : null}
              Criar {projection?.toCreateCount ?? 0} cobrança(s) ·{" "}
              {formatBRL(projection?.toCreateTotal ?? 0)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectionView({
  projection,
  monthLabel,
}: {
  projection: GerarMesProjection;
  monthLabel: string;
}) {
  if (projection.rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Nenhuma cobrança de aluguel a gerar para {monthLabel}.
        {projection.skipped.length > 0
          ? ` ${projection.skipped.length} contrato(s) fora do critério.`
          : ""}
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground tabular-nums">
            {projection.toCreateCount}
          </span>{" "}
          a criar
        </span>
        {projection.alreadyExistsCount > 0 ? (
          <span>
            <span className="font-semibold tabular-nums">
              {projection.alreadyExistsCount}
            </span>{" "}
            já existem
          </span>
        ) : null}
        {projection.flaggedCount > 0 ? (
          <span>
            <span className="font-semibold tabular-nums">
              {projection.flaggedCount}
            </span>{" "}
            com alertas
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Estação</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Fórmula</TableHead>
              <TableHead>Sinalizações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projection.rows.map((row) => {
              const ui = CONTRACT_TYPE_UI[row.contractType];
              return (
                <TableRow
                  key={row.dedupeKey}
                  className={cn(row.alreadyExists && "opacity-55")}
                >
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {row.stationId !== null ? (
                      <span>
                        <span className="font-medium tabular-nums">
                          #{row.stationId}
                        </span>
                        {row.stationName ? (
                          <span className="block max-w-52 truncate text-xs text-muted-foreground">
                            {row.stationName}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Cadastro {row.cadastroId ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    <StatusBadge color={ui?.color ?? "grey"}>
                      {ui?.label ?? row.contractType}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="py-2 text-right font-medium tabular-nums">
                    {formatBRL(row.amount)}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    <span className="block max-w-72">{row.formula}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    <FlagBadges
                      flags={row.flags}
                      alreadyExists={row.alreadyExists}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {projection.skipped.length > 0 ? (
        <details className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground">
            {projection.skipped.length} pulada(s) — desativadas, não-Pix/
            Transferência ou sem cobrança
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {projection.skipped.map((s, i) => (
              <li
                key={`${s.cadastroId ?? s.stationId ?? "x"}-${i}`}
                className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
              >
                {s.stationId !== null ? (
                  <Link
                    href={`/estacoes/${s.stationId}`}
                    className="font-medium tabular-nums hover:underline"
                  >
                    #{s.stationId}
                  </Link>
                ) : (
                  <span className="tabular-nums">
                    Cadastro {s.cadastroId ?? "—"}
                  </span>
                )}
                {s.stationName ? <span>· {s.stationName}</span> : null}
                <span>· {s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
