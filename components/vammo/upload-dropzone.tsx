"use client";

import { UploadCloud, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type UploadItemState =
  | { status: "queued" }
  | { status: "uploading"; progress: number }
  | { status: "done"; message?: string }
  | { status: "duplicate"; message?: string }
  | { status: "error"; message: string };

export type UploadItem = { id: string; file: File; state: UploadItemState };

/**
 * Shared file dropzone for every upload surface (meter photo, comprovante,
 * manual bill). Selection + per-file state rows are rendered here; the actual
 * POST is delegated to `onFiles` (the caller owns the endpoint + validation
 * feedback via the returned state). Client-side it does a cheap size guard only
 * — the server is authoritative (security-ops §5).
 */
export function UploadDropzone({
  accept,
  multiple = false,
  maxBytes,
  items,
  onFiles,
  disabled,
  hint,
  className,
}: {
  accept: string;
  multiple?: boolean;
  maxBytes?: number;
  items: UploadItem[];
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  hint?: React.ReactNode;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  function handle(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, multiple ? undefined : 1);
    onFiles(picked);
  }

  return (
    <div className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) handle(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center transition-colors",
          dragging && "border-vammo-blue bg-accent",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <UploadCloud className="size-6 text-muted-foreground" strokeWidth={2} />
        <span className="text-sm font-medium">
          Arraste {multiple ? "arquivos" : "um arquivo"} aqui ou clique para
          selecionar
        </span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            handle(e.target.files);
            e.target.value = "";
          }}
        />
      </button>

      {items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
              <UploadStateBadge state={item.state} />
            </li>
          ))}
        </ul>
      ) : null}
      {maxBytes ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Tamanho máximo {(maxBytes / 1_000_000).toFixed(0)} MB.
        </p>
      ) : null}
    </div>
  );
}

function UploadStateBadge({ state }: { state: UploadItemState }) {
  switch (state.status) {
    case "queued":
      return <span className="text-xs text-muted-foreground">Na fila</span>;
    case "uploading":
      return (
        <span className="text-xs text-info-emphasis tabular-nums">
          Enviando {state.progress}%
        </span>
      );
    case "done":
      return (
        <span className="text-xs text-success-emphasis">
          {state.message ?? "Concluído"}
        </span>
      );
    case "duplicate":
      return (
        <span className="text-xs text-muted-foreground">
          {state.message ?? "Já enviado"}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-error">
          <X className="size-3" strokeWidth={2} />
          {state.message}
        </span>
      );
  }
}
