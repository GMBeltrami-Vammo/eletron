"use client";

/**
 * "Documentos de e-mail" (decisão #47): the staging tab of /pagamentos. Every
 * cobrança the n8n webhook created sits HERE (hidden from the ledger tabs)
 * until a human validates valor/estação/tipo/vencimento/método and clicks
 * "Enviar para Pagamentos" — or "Descartar" retires it (cancelada, never
 * deleted). Grouped by source document: one PDF → N cobranças (the ND case).
 * Converged rows (a gerar_mes rent that received an email doc) appear for the
 * review click with a "convergida" badge — they are never staged out of the
 * ledger and their discard remedy is "Desvincular".
 */

import * as React from "react";
import {
  Check,
  ExternalLink,
  FileText,
  PencilLine,
  Send,
  Trash2,
  Unlink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatCard } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { ChargeEditorDialog } from "@/components/cobrancas/charge-editor-dialog";
import { UnifyProposalsPanel } from "@/components/revisao/unify-proposals-panel";
import { buildUnifyProposals } from "@/components/revisao/unify-proposals";
import { approveCobranca, approveCobrancas, discardCharges } from "@/app/actions/cobrancas";
import { setChargeDocument } from "@/app/actions/charges";
import { CHARGE_KIND_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

import { VencimentoCell } from "./a-pagar-panel";
import {
  buildEmailDocGroups,
  chargeReadiness,
  isDiscardableEmailCharge,
  READINESS_GAP_LABEL,
  type EmailDocGroup,
} from "./email-docs-groups";
import type { ReviewChargeRow, ReviewQueueData } from "@/app/(app)/revisao/cobrancas/queries";

interface DiscardTarget {
  chargeIds: string[];
  label: string;
}

export function EmailDocsPanel({
  review,
  emailRows,
  canWrite,
}: {
  review: ReviewQueueData;
  /** Pre-filtered tab rows (isEmailDocRow). */
  emailRows: ReviewChargeRow[];
  canWrite: boolean;
}) {
  const { run, pending } = useRunAction();
  const [editing, setEditing] = React.useState<ReviewChargeRow | null>(null);
  const [discarding, setDiscarding] = React.useState<DiscardTarget | null>(null);

  // client BRT wall clock for the vencimento urgency badges (a-pagar pattern)
  const todayIso = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const groups = React.useMemo(() => buildEmailDocGroups(emailRows), [emailRows]);
  const proposals = React.useMemo(
    () => buildUnifyProposals(emailRows, review.mergeTargets),
    [emailRows, review.mergeTargets],
  );
  const totals = React.useMemo(() => {
    let sum = 0;
    for (const r of emailRows) sum += r.amount ?? 0;
    return { docs: groups.length, charges: emailRows.length, sum };
  }, [groups, emailRows]);

  const disabled = pending || !canWrite || !review.available;

  function sendAll(group: EmailDocGroup) {
    void run(
      () =>
        approveCobrancas(group.charges.map((c) => ({ chargeId: c.id, kind: c.kind }))),
      {
        success: (r: { approved: number; failed: number; firstError: string | null }) =>
          r.failed > 0
            ? `${r.approved} enviada(s), ${r.failed} falharam${r.firstError ? ` — ${r.firstError}` : ""}`
            : `${r.approved} cobrança(s) enviada(s) para Pagamentos`,
      },
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Documentos pendentes" value={String(totals.docs)} />
        <StatCard
          label="Cobranças pendentes"
          value={String(totals.charges)}
          tone={totals.charges > 0 ? "warning" : "default"}
        />
        <StatCard label="Valor total em revisão" value={formatBRL(totals.sum)} />
      </div>

      <UnifyProposalsPanel proposals={proposals} available={review.available && canWrite} />

      {groups.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {review.available
            ? "Nenhum documento de e-mail aguardando análise."
            : "Fila indisponível — backend Supabase não configurado."}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            // pag:-keyed email rows are the cadastro's rent charge for the
            // month — never discardable (the RPC refuses them too)
            const discardable = g.charges.filter(isDiscardableEmailCharge);
            return (
              <div key={g.documentId ?? "sem-doc"} className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="text-sm font-medium">
                    {g.filename ?? "Documento sem nome"}
                  </span>
                  {g.documentId ? (
                    <a
                      href={`/api/files/${g.documentId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-info-emphasis underline-offset-2 hover:underline"
                    >
                      Ver PDF
                      <ExternalLink className="size-3" strokeWidth={2} />
                    </a>
                  ) : null}
                  {g.remetente ? (
                    <span className="max-w-56 truncate text-xs text-muted-foreground" title={g.remetente}>
                      {g.remetente}
                    </span>
                  ) : null}
                  {g.receivedAt ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      recebido {formatDate(g.receivedAt.slice(0, 10))}
                    </span>
                  ) : null}
                  <span className="ml-auto inline-flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={disabled}
                      onClick={() => sendAll(g)}
                    >
                      <Send className="size-3.5" strokeWidth={2} />
                      Enviar todas ({g.charges.length})
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled || discardable.length === 0}
                      title={
                        discardable.length === 0
                          ? "Todas as cobranças deste documento já existiam no ledger — use Desvincular por linha"
                          : undefined
                      }
                      onClick={() =>
                        setDiscarding({
                          chargeIds: discardable.map((c) => c.id),
                          label: `documento "${g.filename ?? "sem nome"}" (${discardable.length} cobrança(s))`,
                        })
                      }
                    >
                      <Trash2 className="size-3.5 text-error-emphasis" strokeWidth={2} />
                      Descartar documento
                    </Button>
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {g.charges.map((c) => {
                    const gaps = chargeReadiness(c);
                    const converged = c.source !== "email_ai";
                    // a pag:-keyed email row is the month's rent charge itself
                    // — its wrong-document remedy is Desvincular, not Descartar
                    const discardableRow = isDiscardableEmailCharge(c);
                    return (
                      <li
                        key={c.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm"
                      >
                        <StatusBadge color={CHARGE_KIND_UI[c.kind].color}>
                          {CHARGE_KIND_UI[c.kind].label}
                        </StatusBadge>
                        <span className="font-medium tabular-nums">{formatBRL(c.amount)}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatCompetencia(c.competencia)}
                        </span>
                        <VencimentoCell dueDate={c.dueDate} todayIso={todayIso} />
                        {c.stationId !== null ? (
                          <span className="tabular-nums">
                            #{c.stationId}
                            {c.stationName ? (
                              <span className="text-muted-foreground"> {c.stationName}</span>
                            ) : null}
                          </span>
                        ) : c.parceiro ? (
                          <span className="max-w-40 truncate text-muted-foreground" title={c.parceiro}>
                            {c.parceiro}
                          </span>
                        ) : null}
                        {c.paymentMethod ? (
                          <span className="text-xs text-muted-foreground">
                            {PAYMENT_METHOD_LABEL[c.paymentMethod]}
                          </span>
                        ) : null}
                        {gaps.map((gap) => (
                          <StatusBadge key={gap} color="orange" outline>
                            {READINESS_GAP_LABEL[gap]}
                          </StatusBadge>
                        ))}
                        {gaps.length === 0 ? (
                          <Check className="size-3.5 text-success-emphasis" strokeWidth={2.5} />
                        ) : null}
                        {converged ? (
                          <StatusBadge color="grey">convergida</StatusBadge>
                        ) : null}

                        <span className="ml-auto inline-flex items-center gap-1.5">
                          <Button
                            size="sm"
                            disabled={disabled}
                            onClick={() =>
                              void run(() => approveCobranca(c.id, c.kind), {
                                success: "Enviada para Pagamentos",
                              })
                            }
                          >
                            <Send className="size-3.5" strokeWidth={2} />
                            Enviar para Pagamentos
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={disabled}
                            onClick={() => setEditing(c)}
                          >
                            <PencilLine className="size-3.5" strokeWidth={2} />
                            Editar
                          </Button>
                          {discardableRow ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={disabled}
                              onClick={() =>
                                setDiscarding({
                                  chargeIds: [c.id],
                                  label: `cobrança de ${formatBRL(c.amount)} (${CHARGE_KIND_UI[c.kind].label})`,
                                })
                              }
                            >
                              <Trash2 className="size-3.5 text-error-emphasis" strokeWidth={2} />
                              Descartar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={disabled || c.documentId === null}
                              title={
                                converged
                                  ? "Remove o vínculo do documento — a cobrança continua no ledger"
                                  : "Esta cobrança é o aluguel do mês (chave pag:) — desvincule o documento em vez de descartar"
                              }
                              onClick={() =>
                                void run(
                                  () =>
                                    setChargeDocument({ chargeId: c.id, documentId: null }),
                                  { success: "Documento desvinculado" },
                                )
                              }
                            >
                              <Unlink className="size-3.5" strokeWidth={2} />
                              Desvincular
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <ChargeEditorDialog
          row={editing}
          stations={review.stations}
          cadastros={review.cadastros}
          onClose={() => setEditing(null)}
          title="Editar cobrança"
          description="Ajuste os campos extraídos do documento. Ao salvar, a cobrança é enviada para Pagamentos."
        />
      ) : null}

      {discarding ? (
        <DiscardDialog
          target={discarding}
          pending={pending}
          onConfirm={(reason) =>
            void run(
              () => discardCharges({ chargeIds: discarding.chargeIds, reason }),
              {
                success: (count: number) =>
                  count < discarding.chargeIds.length
                    ? `${count} descartada(s) — as demais já foram resolvidas em outra sessão`
                    : `${count} cobrança(s) descartada(s)`,
              },
              // close only on success — a failure keeps the dialog (and the
              // typed reason) so the human can retry
            ).then((ok) => {
              if (ok) setDiscarding(null);
            })
          }
          onClose={() => setDiscarding(null)}
        />
      ) : null}
    </>
  );
}

function DiscardDialog({
  target,
  pending,
  onConfirm,
  onClose,
}: {
  target: DiscardTarget;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Descartar {target.chargeIds.length > 1 ? "cobranças" : "cobrança"}</DialogTitle>
          <DialogDescription>
            Descartar {target.label}. A entrada sai da fila de análise e fica
            registrada no ledger como cancelada (auditoria) — um reenvio do
            mesmo e-mail não a recria.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label className="text-xs text-muted-foreground">Motivo (opcional)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="ex.: documento não é uma cobrança nossa"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => onConfirm(reason)}
          >
            <Trash2 className="size-4" strokeWidth={2} />
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
