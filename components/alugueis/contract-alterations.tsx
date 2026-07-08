"use client";

/**
 * Contract alteration controls (R4): the rent_manual toggle (Ipiranga / Smart
 * Kitchens curation) and contract cancellation (cancel_contract). Rendered on
 * the contract detail page; hidden entirely when the Supabase uuid is absent
 * (sheets/dev). Roles suspended → any @vammo.com session may act.
 */

import * as React from "react";
import { Ban, Wallet } from "lucide-react";

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
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { cancelContract } from "@/app/actions/alterations";
import { setRentManual } from "@/app/actions/contracts";

export function ContractAlterations({
  contractUuid,
  cadastroId,
  rentManual,
  status,
}: {
  contractUuid: string;
  cadastroId: number;
  rentManual: boolean;
  status: string | null;
}) {
  const { run, pending } = useRunAction();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const inactive = status === "INACTIVE" || status === "DECOMMISSIONED";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rentManual ? (
        <StatusBadge color="blue">Cobrança manual</StatusBadge>
      ) : null}

      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => setRentManual({ contractId: contractUuid, manual: !rentManual, cadastroId }),
            {
              success: rentManual
                ? "Cobrança manual desativada"
                : "Marcado como cobrança manual",
            },
          )
        }
      >
        <Wallet className="size-4" strokeWidth={2} />
        {rentManual ? "Desmarcar cobrança manual" : "Marcar cobrança manual"}
      </Button>

      {!inactive ? (
        <Button
          size="sm"
          variant="outline"
          className="text-error"
          disabled={pending}
          onClick={() => setCancelOpen(true)}
        >
          <Ban className="size-4" strokeWidth={2} />
          Cancelar contrato
        </Button>
      ) : null}

      {!inactive ? (
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancelar contrato</DialogTitle>
              <DialogDescription>
                O contrato fica INATIVO e o Gerar mês para de gerar aluguel para
                ele. Cobranças já geradas não são afetadas.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="cancel-reason">Motivo</Label>
              <Textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: encerramento da locação, saída da estação…"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={pending}>
                Voltar
              </Button>
              <Button
                variant="destructive"
                disabled={pending || !reason.trim()}
                onClick={async () => {
                  const ok = await run(
                    () => cancelContract({ contractId: contractUuid, reason: reason.trim() }),
                    { success: "Contrato cancelado" },
                  );
                  if (ok) setCancelOpen(false);
                }}
              >
                Cancelar contrato
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
