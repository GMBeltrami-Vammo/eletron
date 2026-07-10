"use client";

/**
 * "Conferir manual" (decision #42) — the manual-handling window for faturas the
 * auto-send skips: 2026, WITHOUT débito automático, not yet "Enviado ao fiscal".
 * Opens the FISCAL spreadsheet in a new window to check/add them by hand, lists
 * the pending ones (with the PDF), and marks each done once handled.
 */

import * as React from "react";
import {
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  ScanLine,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL, formatDate } from "@/lib/format";
import {
  getFiscalManualQueue,
  markFaturasFiscalExported,
  type ManualFaturaRow,
} from "@/app/actions/fiscal";

export function FiscalManualDialog({ canWrite }: { canWrite: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sheetUrl, setSheetUrl] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ManualFaturaRow[]>([]);
  const [marking, setMarking] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFiscalManualQueue();
      if (res.ok) {
        setSheetUrl(res.data.sheetUrl);
        setRows(res.data.faturas);
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar a fila");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const markDone = React.useCallback(async (chargeId: string) => {
    setMarking(chargeId);
    try {
      const res = await markFaturasFiscalExported([chargeId]);
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.chargeId !== chargeId));
        toast.success("Marcada como enviada ao fiscal");
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao marcar");
    } finally {
      setMarking(null);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="h-9 bg-card" />}
      >
        <ScanLine className="size-4" strokeWidth={2} />
        Conferir manual
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conferência manual no fiscal</DialogTitle>
          <DialogDescription>
            Faturas de 2026 sem débito automático — o envio em lote não as
            inclui. Confira/adicione cada uma na planilha FISCAL e marque como
            enviada.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          {sheetUrl ? (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
            >
              Abrir planilha fiscal
              <ExternalLink className="size-3.5" strokeWidth={2} />
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">
              FISCAL_SPREADSHEET_ID não configurado
            </span>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">
            {rows.length} pendente(s)
          </span>
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} /> Carregando…
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma fatura pendente de conferência manual.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.chargeId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <StatusBadge color="grey" outline>
                    {r.provider.toUpperCase()}
                  </StatusBadge>
                  <span className="font-medium tabular-nums">
                    {r.installationId}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    venc {formatDate(r.dueDate)}
                  </span>
                  <span className="tabular-nums">{formatBRL(r.amount)}</span>
                  {r.nf ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      NF {r.nf}
                    </span>
                  ) : null}
                  {r.autoDebitRegistration ? (
                    <span
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums"
                      title="Nº de registro do débito automático"
                    >
                      Reg. DA {r.autoDebitRegistration}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">sem nº de registro</span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {r.driveUrl ? (
                      <a
                        href={r.driveUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                        title="Abrir o PDF da fatura"
                      >
                        <FileText className="size-3.5" strokeWidth={2} /> PDF
                      </a>
                    ) : null}
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canWrite || marking === r.chargeId}
                      onClick={() => void markDone(r.chargeId)}
                    >
                      {marking === r.chargeId ? (
                        <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                      ) : (
                        <ListChecks className="size-3" strokeWidth={2} />
                      )}
                      Marcar enviada
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
