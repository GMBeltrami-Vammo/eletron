"use client";

/**
 * PDF viewer — a native-browser `<iframe>` over the session-checked Drive proxy
 * `GET /api/files/[documentId]` with a `#page=N` anchor (zero bundle; page-jump
 * works in Chromium/Firefox by remounting the iframe on hash change via `key`).
 * react-pdf is deferred — only needed for per-region highlighting. On small
 * screens the iframe is replaced by an "Abrir em nova aba" fallback.
 */

import { ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PdfViewer({
  documentId,
  page,
  className,
}: {
  documentId: string;
  page: number;
  className?: string;
}) {
  const fileUrl = `/api/files/${documentId}`;
  const src = `${fileUrl}#page=${page}`;

  return (
    <div className={className}>
      {/* Desktop: inline native PDF render */}
      <div className="hidden md:block">
        <iframe
          key={page}
          src={src}
          title="Comprovante (PDF)"
          className="h-[72vh] w-full rounded-lg border border-border bg-muted"
        />
      </div>

      {/* Mobile fallback */}
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center md:hidden">
        <FileText className="size-6 text-muted-foreground" strokeWidth={2} />
        <p className="text-sm text-muted-foreground">
          Visualização em tela cheia funciona melhor em nova aba.
        </p>
        <Button variant="outline" size="sm" render={<a href={fileUrl} target="_blank" rel="noreferrer" />}>
          <ExternalLink className="size-4" strokeWidth={2} />
          Abrir em nova aba
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">Página {page}</span>
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <ExternalLink className="size-3" strokeWidth={2} />
          Abrir em nova aba
        </a>
      </div>
    </div>
  );
}
