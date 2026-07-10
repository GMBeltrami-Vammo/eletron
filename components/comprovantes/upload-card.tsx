"use client";

/**
 * Upload card — drops comprovante PDFs and, for each, (1) POSTs the whole file
 * to `/api/uploads/comprovante` (same-origin → session → operator → sha256
 * dedupe → Drive), then (2) loops 10-page chunks against
 * `/api/uploads/comprovante/chunk`, driving a progress bar until the document is
 * fully processed (Gabriel 2026-07-10 — replaces the n8n processing + the
 * 20-page inline cap). Per-file state machine:
 *   Enviando → Processando N/M páginas (progress bar) → Concluído · Já enviado
 *   (duplicate) · Protegido por senha · Processando… (deferred, count unknown) ·
 *   Erro.
 */

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { UploadDropzone } from "@/components/vammo/upload-dropzone";

// Vercel caps the request body at ~4.5 MB (same on Pro — the accepted ceiling);
// reject larger files up front with a friendly message instead of a platform 413.
const MAX_BYTES = 4_400_000;
const CHUNK_SIZE = 10;

type UploadRowState =
  | { kind: "uploading" }
  | {
      kind: "chunking";
      documentId: string;
      pagesProcessed: number;
      pageCount: number;
      matched: number;
    }
  | { kind: "processing"; documentId: string }
  | {
      kind: "done";
      documentId: string;
      receipts: number;
      matched: number;
      /** Rule-1 auto-discards (valor não bate com nenhuma cobrança). */
      discarded: number;
      needsReview: boolean;
    }
  | { kind: "duplicate"; documentId: string }
  | { kind: "protected"; documentId: string }
  | { kind: "error"; message: string };

interface UploadRow {
  id: string;
  file: File;
  state: UploadRowState;
}

interface UploadResponse {
  documentId?: string;
  deduplicated?: boolean;
  status?: string;
  pageCount?: number | null;
  error?: string;
}

interface ChunkResponse {
  pageCount?: number;
  pagesProcessed?: number;
  done?: boolean;
  status?: string;
  auto?: number;
  discarded?: number;
  receipts?: number;
  error?: string;
}

export function UploadCard({
  isOperator,
  onUploaded,
}: {
  isOperator: boolean;
  onUploaded: () => void;
}) {
  const [rows, setRows] = React.useState<UploadRow[]>([]);

  const patch = React.useCallback((id: string, state: UploadRowState) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state } : r)));
  }, []);

  const runChunks = React.useCallback(
    async (id: string, documentId: string, pageCount: number) => {
      let matched = 0;
      let discarded = 0;
      let receipts = 0;
      let needsReview = false;
      patch(id, { kind: "chunking", documentId, pagesProcessed: 0, pageCount, matched });

      for (let from = 1; from <= pageCount; from += CHUNK_SIZE) {
        const to = Math.min(from + CHUNK_SIZE - 1, pageCount);
        let res: Response;
        let body: ChunkResponse = {};
        try {
          res = await fetch("/api/uploads/comprovante/chunk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentId, from, to }),
          });
          body = (await res.json()) as ChunkResponse;
        } catch (err) {
          patch(id, {
            kind: "error",
            message: err instanceof Error ? err.message : "Falha no processamento",
          });
          return;
        }
        if (!res.ok || body.error) {
          patch(id, {
            kind: "error",
            message: body.error ?? `Falha no processamento (${res.status})`,
          });
          return;
        }
        matched += body.auto ?? 0;
        discarded += body.discarded ?? 0;
        receipts += body.receipts ?? 0;
        if (body.done && body.status === "needs_review") needsReview = true;
        patch(id, {
          kind: "chunking",
          documentId,
          pagesProcessed: body.pagesProcessed ?? to,
          pageCount: body.pageCount ?? pageCount,
          matched,
        });
        if (body.done) break;
      }
      patch(id, { kind: "done", documentId, receipts, matched, discarded, needsReview });
    },
    [patch],
  );

  const uploadOne = React.useCallback(
    async (row: UploadRow) => {
      try {
        const form = new FormData();
        form.append("file", row.file);
        const res = await fetch("/api/uploads/comprovante", {
          method: "POST",
          body: form,
        });
        let body: UploadResponse = {};
        try {
          body = (await res.json()) as UploadResponse;
        } catch {
          body = {};
        }

        if (res.status === 200 && body.deduplicated && body.documentId) {
          patch(row.id, { kind: "duplicate", documentId: body.documentId });
        } else if (res.status === 422 && body.documentId) {
          patch(row.id, { kind: "protected", documentId: body.documentId });
        } else if (res.ok && body.documentId) {
          onUploaded();
          if (typeof body.pageCount === "number" && body.pageCount > 0) {
            await runChunks(row.id, body.documentId, body.pageCount);
          } else {
            // count unknown → the daily sweep processes it whole
            patch(row.id, { kind: "processing", documentId: body.documentId });
          }
        } else {
          patch(row.id, {
            kind: "error",
            message: body.error ?? `Falha no envio (${res.status})`,
          });
        }
      } catch (err) {
        patch(row.id, {
          kind: "error",
          message: err instanceof Error ? err.message : "Falha no envio",
        });
      } finally {
        onUploaded();
      }
    },
    [patch, onUploaded, runChunks],
  );

  const onFiles = React.useCallback(
    (files: File[]) => {
      const next: UploadRow[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        state: { kind: "uploading" },
      }));
      setRows((prev) => [...next, ...prev]);
      next.forEach((row) => void uploadOne(row));
    },
    [uploadOne],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enviar comprovantes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <UploadDropzone
          accept=".pdf,application/pdf"
          multiple
          maxBytes={MAX_BYTES}
          items={[]}
          onFiles={onFiles}
          disabled={!isOperator}
          hint={
            isOperator
              ? "PDF com uma ou várias páginas — processado em blocos de 10 páginas com barra de progresso; cada página vira um recibo. Reenvios idênticos são deduplicados por hash. Limite ~4 MB por arquivo."
              : "Requer papel operador ou admin para enviar."
          }
        />

        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate" title={row.file.name}>
                  {row.file.name}
                </span>
                <UploadRowBadge state={row.state} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UploadRowBadge({ state }: { state: UploadRowState }) {
  switch (state.kind) {
    case "uploading":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-info-emphasis">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          Enviando…
        </span>
      );
    case "chunking": {
      const pct =
        state.pageCount > 0
          ? Math.min(100, Math.round((state.pagesProcessed / state.pageCount) * 100))
          : 0;
      return (
        <span className="inline-flex items-center gap-2 text-xs text-info-emphasis">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          <span className="tabular-nums">
            {state.pagesProcessed}/{state.pageCount} pág.
          </span>
          <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-info-emphasis transition-all"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      );
    }
    case "processing":
      return (
        <Link
          href={`/comprovantes/${state.documentId}`}
          className="inline-flex items-center gap-1.5 text-xs text-info-emphasis hover:underline"
        >
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          Processando…
        </Link>
      );
    case "done": {
      const detail = (
        <span className="text-muted-foreground tabular-nums">
          · {state.receipts} recibo{state.receipts === 1 ? "" : "s"}
          {state.matched > 0 ? ` · ${state.matched} conciliado${state.matched === 1 ? "" : "s"}` : ""}
          {state.discarded > 0 ? ` · ${state.discarded} descartado${state.discarded === 1 ? "" : "s"}` : ""}
        </span>
      );
      if (state.needsReview) {
        return (
          <Link
            href={`/comprovantes/${state.documentId}`}
            className="inline-flex items-center gap-1.5 text-xs text-warning-emphasis hover:underline"
          >
            <TriangleAlert className="size-3.5" strokeWidth={2} />
            Requer revisão
            {detail}
          </Link>
        );
      }
      return (
        <Link
          href={`/comprovantes/${state.documentId}`}
          className="inline-flex items-center gap-1.5 text-xs text-success-emphasis hover:underline"
        >
          <CheckCircle2 className="size-3.5" strokeWidth={2} />
          Concluído
          {detail}
        </Link>
      );
    }
    case "duplicate":
      return (
        <Link
          href={`/comprovantes/${state.documentId}`}
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          <StatusBadge color="grey" outline>
            Já enviado
          </StatusBadge>
        </Link>
      );
    case "protected":
      return (
        <Link
          href={`/comprovantes/${state.documentId}`}
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          <StatusBadge color="orange">Protegido por senha</StatusBadge>
        </Link>
      );
    case "error":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-error"
          title={state.message}
        >
          <XCircle className="size-3.5" strokeWidth={2} />
          <span className="max-w-48 truncate">{state.message}</span>
        </span>
      );
    default:
      return <TriangleAlert className="size-3.5 text-muted-foreground" />;
  }
}
