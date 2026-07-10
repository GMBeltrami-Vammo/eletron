"use client";

/**
 * Deep-dive orchestrator (client): sticky PDF viewer on the left, content stack
 * on the right. Owns the deep-dive query seeded by the server and polls every
 * 5 s while the document is still `pending`. Receipt cards drive the viewer's
 * page jump by lifting the `page` state here.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditByline } from "@/components/vammo/audit-byline";
import { StatusBadge } from "@/components/vammo/status-badge";
import { reprocessComprovante } from "@/app/actions/comprovantes";
import { formatBRL } from "@/lib/format";

import { fetchDeepDiveData } from "./actions";
import { BindingsTable } from "./bindings-table";
import { PdfViewer } from "./pdf-viewer";
import { ReceiptCard } from "./receipt-card";
import { PROCESSING_STATUS_UI } from "./labels";
import type { DeepDiveData, ViewerContext } from "./types";
import { Gate, useRunAction } from "./write-helpers";

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

/** Operator-gated "Reprocessar" for a failed or stuck-pending document. */
function ReprocessButton({
  isOperator,
  pending,
  onReprocess,
}: {
  isOperator: boolean;
  pending: boolean;
  onReprocess: () => void;
}) {
  return (
    <Gate isOperator={isOperator}>
      <Button
        size="sm"
        variant="outline"
        disabled={!isOperator || pending}
        onClick={onReprocess}
      >
        <RefreshCw
          className={pending ? "size-4 animate-spin" : "size-4"}
          strokeWidth={2}
        />
        Reprocessar
      </Button>
    </Gate>
  );
}

export function ComprovanteDetail({
  documentId,
  initialData,
  viewer,
  initialPage = 1,
}: {
  documentId: string;
  initialData: DeepDiveData;
  viewer: ViewerContext;
  /** ?page=N deep-link from ledger comprovante chips (R1). */
  initialPage?: number;
}) {
  const [page, setPage] = React.useState(initialPage);

  const detailKey = React.useMemo(
    () => ["comprovante-detail", documentId] as const,
    [documentId],
  );

  const { data = initialData } = useQuery({
    queryKey: detailKey,
    queryFn: () => fetchDeepDiveData(documentId),
    initialData,
    refetchInterval: (query) =>
      query.state.data?.document?.processingStatus === "pending"
        ? 5_000
        : false,
  });

  const invalidate = React.useMemo(() => [detailKey], [detailKey]);

  const { run, pending: actionPending } = useRunAction();
  const reprocess = React.useCallback(() => {
    void run(() => reprocessComprovante(documentId), {
      success: "Reprocessamento concluído",
      invalidate,
    });
  }, [run, documentId, invalidate]);

  const doc = data.document;

  if (!doc) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {data.available
          ? "Comprovante não encontrado."
          : "Sem conexão com o banco (Supabase) — comprovante indisponível."}
      </p>
    );
  }

  const counts = { conciliado: 0, awaiting: 0, ambiguous: 0, unmatched: 0 };
  for (const r of data.receipts) counts[r.badge] += 1;
  const statusUi = PROCESSING_STATUS_UI[doc.processingStatus];
  const isPending = doc.processingStatus === "pending";
  const isFailed = doc.processingStatus === "failed";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,45%)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:self-start">
        <PdfViewer documentId={documentId} page={page} />
      </div>

      <div className="space-y-5">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1
                className="truncate text-xl font-semibold text-foreground"
                title={doc.filename ?? undefined}
              >
                {doc.filename ?? "Comprovante"}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <AuditByline
                  actorEmail={doc.uploadedByEmail}
                  at={doc.createdAt}
                />
                <span
                  className="font-mono text-[11px] text-muted-foreground"
                  title={`SHA-256: ${doc.contentHash}`}
                >
                  sha256 {doc.contentHash.slice(0, 12)}…
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusBadge color={statusUi.color}>{statusUi.label}</StatusBadge>
              <Button
                variant="outline"
                size="sm"
                render={<a href={`/api/files/${documentId}`} download />}
              >
                <Download className="size-4" strokeWidth={2} />
                Baixar
              </Button>
              {doc.webViewLink && viewer.isAdmin ? (
                <Button
                  variant="ghost"
                  size="sm"
                  render={
                    <a
                      href={doc.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                    />
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
          <Stat label="Recibos" value={data.receipts.length} />
          <Stat label="Soma dos recibos" value={formatBRL(data.totals.receiptsSum)} />
          <Stat
            label="Conciliação"
            value={
              <span
                className="inline-flex items-center gap-1.5 text-sm"
                title="conciliados · aguardando · ambíguos · sem correspondência"
              >
                <span className="text-success-emphasis">{counts.conciliado}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-warning-emphasis">{counts.awaiting}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-warning-emphasis">{counts.ambiguous}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-error">{counts.unmatched}</span>
              </span>
            }
          />
        </div>

        {/* Estações relacionadas */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            Estações relacionadas
          </h2>
          {data.stations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum vínculo ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.stations.map((s) => (
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

        {/* Recibos */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Recibos</h2>
          {isFailed ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Falha no processamento</AlertTitle>
              <AlertDescription>
                {doc.processingError ?? "Não foi possível extrair este comprovante."}
                <span className="mt-2 inline-flex">
                  <ReprocessButton
                    isOperator={viewer.isOperator}
                    pending={actionPending}
                    onReprocess={reprocess}
                  />
                </span>
              </AlertDescription>
            </Alert>
          ) : isPending ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Processando… os recibos aparecem assim que a extração terminar.
              </p>
              <ReprocessButton
                isOperator={viewer.isOperator}
                pending={actionPending}
                onReprocess={reprocess}
              />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : data.receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum recibo reconhecido neste documento.
            </p>
          ) : (
            <div className="space-y-3">
              {data.receipts.map((r) => (
                <ReceiptCard
                  key={r.id}
                  receipt={r}
                  documentId={documentId}
                  isOperator={viewer.isOperator}
                  onJumpToPage={setPage}
                  invalidate={invalidate}
                />
              ))}
            </div>
          )}
        </section>

        {/* Faturas vinculadas a este comprovante (add via ReceiptCard "Conciliar…", remove here) */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            Faturas vinculadas a este comprovante
          </h2>
          <BindingsTable
            payments={data.payments}
            totals={data.totals}
            isOperator={viewer.isOperator}
            invalidate={invalidate}
          />
        </section>
      </div>
    </div>
  );
}
