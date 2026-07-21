"use client";

/**
 * Charge-first manual matcher dialog (Gabriel 2026-07-17, spec
 * 2026-07-17-vincular-comprovante-charge-first). Opened from a blank Comprovante
 * cell: the header shows the charge (valor + payment details) and the list shows
 * the UNBOUND receipts of the same value (±R$0,50). Binding one goes through the
 * existing `recordPayment` chokepoint → charge `pago` (#29) + manual_match_log
 * (#60). No new RPC.
 */

import * as React from "react";
import { ExternalLink, Link2, Loader2 } from "lucide-react";

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
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { recordPayment } from "@/app/actions/charges";
import {
  loadBindCandidates,
  type BindCandidate,
  type BindContext,
} from "@/app/actions/bind-comprovante";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import {
  formatBRL,
  formatCnpjCpf,
  formatCompetencia,
  formatDate,
} from "@/lib/format";

const RECEIPT_TYPE_LABEL: Record<string, string> = {
  pix: "PIX",
  ted: "TED",
  transferencia: "Transferência",
  boleto: "Boleto",
  debito_automatico: "Débito automático",
  titulos: "Títulos",
  tributos: "Tributos",
  outro: "Outro",
};

export function BindComprovanteDialog({
  dedupeKey,
  onClose,
}: {
  dedupeKey: string;
  onClose: () => void;
}) {
  const { run, pending } = useRunAction();
  const [ctx, setCtx] = React.useState<BindContext | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setCtx(null);
    void loadBindCandidates(dedupeKey, showAll).then((res) => {
      if (alive) setCtx(res);
    });
    return () => {
      alive = false;
    };
  }, [dedupeKey, showAll]);

  const charge = ctx?.charge ?? null;

  function bind(candidate: BindCandidate) {
    if (!charge || charge.amount === null) return;
    void run(
      () =>
        recordPayment({
          chargeId: charge.chargeUuid,
          receiptId: candidate.receiptId,
          amount: charge.amount as number,
          paidAt: candidate.paidAt ?? null,
          method: charge.paymentMethod ?? null,
        }),
      { success: "Comprovante vinculado" },
    ).then((ok) => {
      if (ok) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular comprovante</DialogTitle>
          <DialogDescription>
            Comprovantes ainda sem vínculo com valor próximo{" "}
            {showAll ? "(todos os valores)" : "(±R$0,50)"}. Vincular marca a
            cobrança como paga.
          </DialogDescription>
        </DialogHeader>

        {ctx === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            Carregando…
          </div>
        ) : !ctx.available ? (
          <p className="py-6 text-sm text-muted-foreground">
            Indisponível — backend Supabase não configurado.
          </p>
        ) : !charge ? (
          <p className="py-6 text-sm text-muted-foreground">
            Cobrança não encontrada.
          </p>
        ) : (
          <>
            {/* Charge header — what we're paying */}
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-base font-semibold tabular-nums">
                  {formatBRL(charge.amount)}
                </span>
                {charge.stationName || charge.stationId !== null ? (
                  <span className="text-muted-foreground">
                    {charge.stationName ?? `Estação #${charge.stationId}`}
                  </span>
                ) : null}
                {charge.competencia ? (
                  <span className="text-muted-foreground">
                    comp. {formatCompetencia(charge.competencia)}
                  </span>
                ) : null}
                {charge.dueDate ? (
                  <span className="text-muted-foreground">
                    venc. {formatDate(charge.dueDate)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {charge.paymentMethod ? (
                  <span>{PAYMENT_METHOD_LABEL[charge.paymentMethod]}</span>
                ) : null}
                {charge.chavePix ? (
                  <span className="font-mono">PIX {charge.chavePix}</span>
                ) : null}
                {charge.banco || charge.agencia || charge.conta ? (
                  <span className="font-mono">
                    {[charge.banco, charge.agencia, charge.conta]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
                {charge.cnpj ? (
                  <span className="font-mono">CNPJ {formatCnpjCpf(charge.cnpj)}</span>
                ) : null}
              </div>
            </div>

            {/* Value-window toggle — ±R$0,50 vs all values (juros/multa) */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {showAll
                  ? "Mostrando comprovantes de todos os valores"
                  : "Valor ≈ o da cobrança (±R$0,50)"}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Filtrar por valor" : "Ver todos os valores"}
              </Button>
            </div>

            {/* Candidate receipts */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {ctx.candidates.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {showAll
                    ? "Nenhum comprovante solto disponível."
                    : 'Nenhum comprovante solto com esse valor (±R$0,50). Tente "Ver todos os valores".'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {ctx.candidates.map((r) => (
                    <li
                      key={r.receiptId}
                      className="rounded-lg border border-border bg-card px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={r.filename ?? ""}>
                            {r.filename ?? "Comprovante sem nome"}
                            {r.pageNumber ? (
                              <span className="ml-1 font-normal text-muted-foreground">
                                · pág. {r.pageNumber}
                              </span>
                            ) : null}
                          </p>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="tabular-nums">{formatBRL(r.amount)}</span>
                            {r.paidAt ? <span>{formatDate(r.paidAt)}</span> : null}
                            {r.receiptType ? (
                              <span>
                                {RECEIPT_TYPE_LABEL[r.receiptType] ?? r.receiptType}
                              </span>
                            ) : null}
                            {r.chavePix ? (
                              <span className="font-mono">PIX {r.chavePix}</span>
                            ) : null}
                            {r.cnpjCpf ? (
                              <span className="font-mono">
                                CNPJ {formatCnpjCpf(r.cnpjCpf)}
                              </span>
                            ) : null}
                            {r.banco || r.agencia || r.conta ? (
                              <span className="font-mono">
                                {[r.banco, r.agencia, r.conta].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {r.documentId ? (
                            <a
                              href={`/api/files/${r.documentId}${r.pageNumber ? `/page/${r.pageNumber}` : ""}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-info-emphasis underline-offset-2 hover:underline"
                            >
                              ver
                              <ExternalLink className="size-3" strokeWidth={2} />
                            </a>
                          ) : null}
                          <Button size="sm" disabled={pending} onClick={() => bind(r)}>
                            <Link2 className="size-3.5" strokeWidth={2} />
                            Vincular
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {ctx.truncated ? (
                <p className="pt-2 text-center text-xs text-warning-emphasis">
                  Mostrando os primeiros 200 comprovantes desse valor — pode haver
                  mais. Use o filtro por valor em /revisão › Comprovantes se faltar
                  algum.
                </p>
              ) : null}
            </div>
          </>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
