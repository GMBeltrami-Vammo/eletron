"use client";

/**
 * Upload card — drops multiple comprovante PDFs and POSTs each to
 * `/api/uploads/comprovante` (the committed route: same-origin → session →
 * operator → sha256 dedupe-before-Drive → inline pipeline for ≤20-page PDFs).
 * Per-file state machine mirrors the route's response shapes:
 *   Enviando → Processando (pending/deferred) | Concluído | Já enviado
 *   (duplicate, links to the original) | Protegido por senha | Erro.
 */

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { UploadDropzone } from "@/components/vammo/upload-dropzone";

const MAX_BYTES = 25_000_000;

type UploadRowState =
  | { kind: "uploading" }
  | { kind: "processing"; documentId: string }
  | { kind: "done"; documentId: string; receipts: number }
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
  receipts?: unknown[];
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
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, state } : r)),
    );
  }, []);

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
          if (body.status === "pending") {
            patch(row.id, { kind: "processing", documentId: body.documentId });
          } else {
            patch(row.id, {
              kind: "done",
              documentId: body.documentId,
              receipts: Array.isArray(body.receipts) ? body.receipts.length : 0,
            });
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
    [patch, onUploaded],
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
              ? "PDF com uma ou várias páginas — cada página vira um recibo. Reenvios idênticos são deduplicados por hash."
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
    case "done":
      return (
        <Link
          href={`/comprovantes/${state.documentId}`}
          className="inline-flex items-center gap-1.5 text-xs text-success-emphasis hover:underline"
        >
          <CheckCircle2 className="size-3.5" strokeWidth={2} />
          Concluído
          <span className="text-muted-foreground tabular-nums">
            · {state.receipts} recibo{state.receipts === 1 ? "" : "s"}
          </span>
        </Link>
      );
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
