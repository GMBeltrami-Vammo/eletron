"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Field, maskTail } from "./contract-utils";

/**
 * Bank data with a client-side reveal toggle (spec §3, Aluguel tab). Bank
 * NAME stays visible; agência/conta/chave Pix are masked until revealed.
 * Phase 2 audits each reveal server-side — here the toggle is local only.
 */
export function BankDataReveal({
  banco,
  agencia,
  conta,
  chavePix,
}: {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
}) {
  const [revealed, setRevealed] = React.useState(false);

  if (!banco && !agencia && !conta && !chavePix) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem dados bancários cadastrados.
      </p>
    );
  }

  const show = (value: string | null) =>
    value ? (revealed ? value : maskTail(value)) : "—";

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3">
        <Field label="Banco">{banco ?? "—"}</Field>
        <Field label="Agência">
          <span className="tabular-nums">{show(agencia)}</span>
        </Field>
        <Field label="Conta">
          <span className="tabular-nums">{show(conta)}</span>
        </Field>
        <Field label="Chave Pix">
          <span className="break-all tabular-nums">{show(chavePix)}</span>
        </Field>
      </dl>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setRevealed((r) => !r)}
      >
        {revealed ? (
          <EyeOff className="size-4" strokeWidth={2} />
        ) : (
          <Eye className="size-4" strokeWidth={2} />
        )}
        {revealed ? "Ocultar" : "Revelar"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Na fase 2, cada revelação será registrada em auditoria.
      </p>
    </div>
  );
}
