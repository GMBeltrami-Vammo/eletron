"use client";

/**
 * Boleto document deep-dive (Gabriel 2026-07-14) — the billing analogue of the
 * comprovante deep-dive (/comprovantes/[id]): the PDF on one half, the data on
 * the other. Shows EVERY cobrança bound to the document (staged, approved or
 * manually added) with the shared editor, plus "Adicionar cobrança" to register
 * a line the AI missed (the ND case) and "Enviar para Pagamentos" to approve a
 * staged one. Reuses the comprovante PdfViewer + the cobrança RPCs/dialogs.
 */

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Download,
  ExternalLink,
  Mail,
  PencilLine,
  Send,
  Unlink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/vammo/status-badge";
import { PdfViewer } from "@/components/comprovantes/pdf-viewer";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { ChargeEditorDialog } from "@/components/cobrancas/charge-editor-dialog";
import { NovaCobrancaDialog } from "@/components/pagamentos/nova-cobranca-dialog";
import {
  isStagedEmailCharge,
  chargeReadiness,
  READINESS_GAP_LABEL,
} from "@/components/pagamentos/email-docs-groups";
import { approveCobranca } from "@/app/actions/cobrancas";
import { setChargeDocument } from "@/app/actions/charges";
import { CHARGE_KIND_UI, CHARGE_STATUS_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import type {
  ReviewChargeRow,
  StationOption,
  CadastroOption,
} from "@/app/(app)/revisao/cobrancas/queries";

import type { DocumentDeepDive } from "@/app/(app)/documentos/[id]/queries";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function DocumentoDetail({
  data,
  stations,
  cadastros,
  canWrite,
  prevId,
  nextId,
  position,
}: {
  data: DocumentDeepDive;
  stations: StationOption[];
  cadastros: CadastroOption[];
  canWrite: boolean;
  /** Adjacent documents in the "Documentos de e-mail" list (null = none). */
  prevId?: string | null;
  nextId?: string | null;
  /** 1-based position in that list, for "3 / 12" (null when not in the list). */
  position?: { current: number; total: number } | null;
}) {
  const { run, pending } = useRunAction();
  const [editing, setEditing] = React.useState<ReviewChargeRow | null>(null);
  const [adding, setAdding] = React.useState(false);

  // distinct stations the document's charges touch (hook before any early return)
  const stationPills = React.useMemo(() => {
    const seen = new Map<number, string | null>();
    for (const c of data.charges) {
      if (c.stationId !== null && !seen.has(c.stationId)) {
        seen.set(c.stationId, c.stationName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [data.charges]);

  const doc = data.document;
  if (!doc) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {data.available
          ? "Documento não encontrado."
          : "Sem conexão com o banco (Supabase) — documento indisponível."}
      </p>
    );
  }

  const disabled = pending || !canWrite;

  const defaultCompetencia = data.charges[0]?.competencia?.slice(0, 7);
  const defaultStationId = data.charges[0]?.stationId ?? null;

  return (
    <>
      {prevId || nextId || position ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {prevId ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/documentos/${prevId}`} />}
            >
              <ChevronLeft className="size-4" strokeWidth={2} />
              Anterior
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft className="size-4" strokeWidth={2} />
              Anterior
            </Button>
          )}
          {position ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {position.current} / {position.total} documentos
            </span>
          ) : null}
          {nextId ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/documentos/${nextId}`} />}
            >
              Próximo pagamento
              <ChevronRight className="size-4" strokeWidth={2} />
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Próximo pagamento
              <ChevronRight className="size-4" strokeWidth={2} />
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,45%)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <PdfViewer documentId={doc.id} page={1} />
        </div>

        <div className="space-y-5">
          {/* Header */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1
                  className="truncate text-xl font-semibold text-foreground"
                  title={doc.filename ?? undefined}
                >
                  {doc.filename ?? "Documento"}
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {doc.createdAt ? (
                    <span className="tabular-nums">
                      recebido {formatDate(doc.createdAt.slice(0, 10))}
                    </span>
                  ) : null}
                  {doc.addresses.length > 0 ? (
                    <span
                      className="inline-flex items-center gap-1"
                      title={`Recebido via: ${doc.addresses.join(", ")}`}
                    >
                      <Mail className="size-3.5 shrink-0" strokeWidth={2} />
                      <span className="max-w-72 truncate">
                        {doc.addresses.join(", ")}
                      </span>
                    </span>
                  ) : doc.remetente ? (
                    <span className="max-w-72 truncate" title={doc.remetente}>
                      {doc.remetente}
                    </span>
                  ) : null}
                  {doc.contentHash ? (
                    <span
                      className="font-mono text-[11px]"
                      title={`SHA-256: ${doc.contentHash}`}
                    >
                      sha256 {doc.contentHash.slice(0, 12)}…
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  render={<a href={`/api/files/${doc.id}`} download />}
                >
                  <Download className="size-4" strokeWidth={2} />
                  Baixar
                </Button>
                {doc.webViewLink ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    render={
                      <a href={doc.webViewLink} target="_blank" rel="noreferrer" />
                    }
                  >
                    <ExternalLink className="size-4" strokeWidth={2} />
                    Drive
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Resumo */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-4">
            <Stat label="Páginas" value={doc.pageCount ?? "—"} />
            <Stat label="Cobranças" value={data.charges.length} />
            <Stat label="Soma" value={formatBRL(data.totalAmount)} />
            <Stat label="Estações" value={stationPills.length} />
          </div>

          {/* Estações relacionadas */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              Estações relacionadas
            </h2>
            {stationPills.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum vínculo ainda.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stationPills.map((s) => (
                  <Link
                    key={s.id}
                    href={`/estacoes/${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    <span className="font-medium tabular-nums">#{s.id}</span>
                    {s.name ? (
                      <span className="max-w-40 truncate text-muted-foreground">
                        {s.name}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Cobranças */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Cobranças</h2>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                title="Registrar uma cobrança que a IA não extraiu (ex.: linha faltante de uma ND)"
                onClick={() => setAdding(true)}
              >
                <CirclePlus className="size-3.5" strokeWidth={2} />
                Adicionar cobrança
              </Button>
            </div>
            {data.charges.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma cobrança vinculada a este documento.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {data.charges.map((c) => {
                  const staged = isStagedEmailCharge(c);
                  const gaps = chargeReadiness(c);
                  const statusUi = CHARGE_STATUS_UI[c.status];
                  return (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm"
                    >
                      <StatusBadge color={CHARGE_KIND_UI[c.kind].color}>
                        {CHARGE_KIND_UI[c.kind].label}
                      </StatusBadge>
                      <span className="font-medium tabular-nums">
                        {formatBRL(c.amount)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCompetencia(c.competencia)}
                      </span>
                      {c.dueDate ? (
                        <span className="tabular-nums text-muted-foreground">
                          venc. {formatDate(c.dueDate)}
                        </span>
                      ) : null}
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
                      ) : (
                        <span className="text-muted-foreground">sem estação</span>
                      )}
                      {c.paymentMethod ? (
                        <span className="text-xs text-muted-foreground">
                          {PAYMENT_METHOD_LABEL[c.paymentMethod]}
                        </span>
                      ) : null}
                      {staged ? (
                        gaps.map((gap) => (
                          <StatusBadge key={gap} color="orange" outline>
                            {READINESS_GAP_LABEL[gap]}
                          </StatusBadge>
                        ))
                      ) : (
                        <StatusBadge color={statusUi.color}>{statusUi.label}</StatusBadge>
                      )}

                      <span className="ml-auto inline-flex items-center gap-1.5">
                        {staged ? (
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
                            Enviar
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => setEditing(c)}
                        >
                          <PencilLine className="size-3.5" strokeWidth={2} />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disabled}
                          title="Remove o vínculo com este documento (não apaga a cobrança)"
                          onClick={() =>
                            void run(
                              () => setChargeDocument({ chargeId: c.id, documentId: null }),
                              { success: "Documento desvinculado" },
                            )
                          }
                        >
                          <Unlink className="size-3.5" strokeWidth={2} />
                          Desvincular
                        </Button>
                        {!staged && c.status ? (
                          <Check
                            className="size-3.5 text-success-emphasis"
                            strokeWidth={2.5}
                            aria-hidden
                          />
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editing ? (
        <ChargeEditorDialog
          row={editing}
          stations={stations}
          cadastros={cadastros}
          onClose={() => setEditing(null)}
          title="Editar cobrança"
          description="Ajuste os campos extraídos do documento."
        />
      ) : null}

      {adding ? (
        <NovaCobrancaDialog
          key={doc.id}
          canWrite={canWrite}
          stations={stations}
          documentId={doc.id}
          defaultCompetencia={defaultCompetencia}
          defaultStationId={defaultStationId}
          open
          onOpenChange={(o) => {
            if (!o) setAdding(false);
          }}
        />
      ) : null}
    </>
  );
}
