"use client";

/**
 * Contract-intake review queue (Q10): lists every `pending` contract_intake the
 * n8n webhook staged, with a PDF-proxy link and a confirm dialog whose fields
 * are pre-filled from the AI extraction (mapped to the domain enums). "Revisar e
 * confirmar" creates the real contract (+ counterparty + rent account) via the
 * confirm_contract_intake RPC; "Rejeitar" discards it with a reason. Both go
 * through the server actions in app/actions/contracts.ts.
 */

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, ExternalLink, PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/vammo/data-table";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { ContractIntakeFields } from "@/components/contratos/contract-intake-fields";
import { rejectContractIntake } from "@/app/actions/contracts";

import type {
  ContratoIntakeRow,
  StationOption,
} from "@/app/(app)/revisao/contratos/queries";

export function ContratosReview({
  rows,
  stations,
  available,
}: {
  rows: ContratoIntakeRow[];
  stations: StationOption[];
  available: boolean;
}) {
  const [editing, setEditing] = React.useState<ContratoIntakeRow | null>(null);
  const [rejecting, setRejecting] = React.useState<ContratoIntakeRow | null>(null);
  const { pending } = useRunAction();

  const stationName = React.useMemo(
    () => new Map(stations.map((s) => [s.id, s.name])),
    [stations],
  );

  const columns = React.useMemo<ColumnDef<ContratoIntakeRow, unknown>[]>(
    () => [
      {
        id: "parceiro",
        header: "Parceiro locador",
        accessorFn: (r) => r.counterpartyName ?? "",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="text-sm">
              <span className="font-medium">
                {r.counterpartyName ?? (
                  <span className="text-muted-foreground">sem parceiro</span>
                )}
              </span>
              {r.counterpartyCnpj ? (
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {r.counterpartyCnpj}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "endereco",
        header: "Endereço",
        accessorFn: (r) => r.endereco ?? "",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.endereco ?? <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        id: "estacao",
        header: "Estação",
        accessorFn: (r) => r.swapStationId ?? Number.MIN_SAFE_INTEGER,
        cell: ({ row }) => {
          const id = row.original.swapStationId;
          if (id === null) return <span className="text-muted-foreground">sem estação</span>;
          const known = stationName.has(id);
          return (
            <span className={known ? "text-sm font-medium" : "text-sm text-warning-emphasis"}>
              #{id} {stationName.get(id) ?? "(não encontrada)"}
            </span>
          );
        },
      },
      {
        id: "pdf",
        header: "PDF",
        enableSorting: false,
        accessorFn: (r) => (r.documentId ? "sim" : ""),
        cell: ({ row }) =>
          row.original.documentId ? (
            <a
              href={`/api/files/${row.original.documentId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-info-emphasis underline-offset-2 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Ver PDF
              <ExternalLink className="size-3.5" strokeWidth={2} />
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "acoes",
        header: "Ações",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !available}
                onClick={() => setRejecting(r)}
              >
                <Ban className="size-4" strokeWidth={2} />
                Rejeitar
              </Button>
              <Button size="sm" disabled={!available} onClick={() => setEditing(r)}>
                <PencilLine className="size-4" strokeWidth={2} />
                Revisar e confirmar
              </Button>
            </div>
          );
        },
      },
    ],
    [pending, available, stationName],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Buscar parceiro, endereço, estação…"
        csvFilename="contratos-revisao"
        initialSorting={[{ id: "parceiro", desc: false }]}
        filterableColumnIds="all"
        emptyMessage={
          available
            ? "Nenhum contrato aguardando revisão."
            : "Fila indisponível — backend Supabase não configurado."
        }
      />
      {editing ? (
        <ConfirmDialog
          row={editing}
          stations={stations}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {rejecting ? (
        <RejectDialog row={rejecting} onClose={() => setRejecting(null)} />
      ) : null}
    </>
  );
}

function ConfirmDialog({
  row,
  stations,
  onClose,
}: {
  row: ContratoIntakeRow;
  stations: StationOption[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar e confirmar contrato</DialogTitle>
          <DialogDescription>
            Confira os dados extraídos pela IA. Ao confirmar, o contrato, o
            parceiro e a conta de aluguel são criados.
          </DialogDescription>
        </DialogHeader>
        <ContractIntakeFields
          intakeId={row.id}
          prefill={row}
          stations={stations}
          onConfirmed={onClose}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  row,
  onClose,
}: {
  row: ContratoIntakeRow;
  onClose: () => void;
}) {
  const { run, pending } = useRunAction();
  const [reason, setReason] = React.useState("");

  async function save() {
    const ok = await run(
      () => rejectContractIntake({ intakeId: row.id, reason: reason.trim() }),
      { success: "Contrato rejeitado" },
    );
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rejeitar contrato</DialogTitle>
          <DialogDescription>
            {row.counterpartyName
              ? `Descartar o contrato de ${row.counterpartyName}.`
              : "Descartar este cadastro de contrato."}{" "}
            Nenhum contrato será criado.
          </DialogDescription>
        </DialogHeader>
        <Field label="Motivo">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Por que este contrato está sendo rejeitado?"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={save}
            disabled={pending || reason.trim() === ""}
          >
            Rejeitar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
