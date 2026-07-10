"use client";

/**
 * "Resetar comprovantes" — a DESTRUCTIVE stress-test tool (Gabriel 2026-07-10,
 * cold test clone). Behind an explicit confirmation dialog, it unbinds every
 * comprovante and returns comprovante state to zero so the same PDFs can be
 * re-dropped and re-matched. Operator-gated (RLS is the real gate).
 */

import * as React from "react";
import { RotateCcw } from "lucide-react";
import type { QueryKey } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resetComprovanteMatches } from "@/app/actions/comprovantes";

import { Gate, useRunAction } from "./write-helpers";

export function ResetComprovantesButton({
  isOperator,
  invalidate,
}: {
  isOperator: boolean;
  invalidate: QueryKey[];
}) {
  const { run, pending } = useRunAction();
  const [open, setOpen] = React.useState(false);

  async function confirm() {
    const ok = await run(() => resetComprovanteMatches(), {
      success: "Comprovantes resetados — pode reenviar os PDFs",
      invalidate,
    });
    if (ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Gate isOperator={isOperator}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={!isOperator} />}
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Resetar comprovantes
        </DialogTrigger>
      </Gate>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resetar comprovantes</DialogTitle>
          <DialogDescription>
            Remove TODOS os comprovantes e vínculos: apaga os pagamentos com
            comprovante, os recibos, as páginas isoladas e os PDFs de comprovante
            (no Supabase e no Drive), e volta ao estado &ldquo;em aberto&rdquo; as
            cobranças que um comprovante marcou como pagas. As cobranças pagas
            pelo portal/scraper são preservadas. Use para reprocessar os mesmos
            PDFs do zero. Ação irreversível.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={pending} />}>
            Cancelar
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Resetando…" : "Resetar tudo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
