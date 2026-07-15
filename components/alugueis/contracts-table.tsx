"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Power } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { setContractActive } from "@/app/actions/contracts";
import { formatBRL, formatDate } from "@/lib/format";
import {
  ALERT_TYPE_UI,
  CONTRACT_TYPE_UI,
  PAYMENT_METHOD_LABEL,
} from "@/lib/labels";
import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";

import { type ContractEndInfo } from "./contract-utils";

/** Plain-JSON row precomputed on the server (page.tsx). */
export interface ContractRow {
  cadastroId: number | null;
  /** Postgres uuid (resolved from cadastro_id); null → toggle read-only. */
  contractId: string | null;
  stationId: number | null;
  /** stationId points at a station that exists in the snapshot. */
  stationExists: boolean;
  stationName: string | null;
  parceiro: string | null;
  contractType: ContractType | null;
  formula: string | null;
  valorMensal: number | null;
  dueDay: number | null;
  paymentMethod: PaymentMethod | null;
  status: StationStatus | null;
  /** Station's own status (for the "sugerir inativar" signal). */
  stationStatus: StationStatus | null;
  /** Metabase active boxes (for the reactivate/inactivate signals). */
  activeBoxes: number | null;
  /** contracts.inactivated_on — shown when Inativo, drives last-month pro-rata. */
  inactivatedOn: string | null;
  startsOn: string | null;
  endsOn: string | null;
  endInfo: ContractEndInfo | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  /** Masked on the server — full document never reaches the list. */
  cnpjCpfMasked: string | null;
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/**
 * Editable "Contrato Ativo" cell (#51): Ativo/Inativo badge + toggle. Only
 * Ativos entram no gerar-mês; ao inativar, grava a data (pró-rata do último
 * mês). Sinais: sugerir inativar (estação Decommissioned + 0 boxes) e o aviso
 * CRÍTICO de reativar (Inativo mas com boxes ativos). Humano-only (qualquer
 * @vammo.com por ora).
 */
function ContratoAtivoCell({ row }: { row: ContractRow }) {
  const { run, pending } = useRunAction();
  const [dialog, setDialog] = React.useState<null | "inativar" | "reativar">(null);
  const [date, setDate] = React.useState(todayIso());
  const [reason, setReason] = React.useState("");

  const isActive = row.status === "ACTIVE";
  const boxes = row.activeBoxes ?? 0;
  const suggestInactivate =
    isActive && row.stationStatus === "DECOMMISSIONED" && boxes === 0;
  const reactivateCritical = !isActive && boxes > 0;
  const canToggle = row.contractId !== null;

  function submit(active: boolean) {
    void run(
      () =>
        setContractActive({
          contractId: row.contractId as string,
          active,
          inactivatedOn: active ? null : date,
          reason: reason || null,
          cadastroId: row.cadastroId,
        }),
      { success: active ? "Contrato reativado" : "Contrato inativado" },
    ).then((ok) => {
      if (ok) {
        setDialog(null);
        setReason("");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5">
        <StatusBadge color={isActive ? "green" : "grey"}>
          {isActive ? "Ativo" : "Inativo"}
        </StatusBadge>
        {canToggle ? (
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setDate(todayIso());
              setDialog(isActive ? "inativar" : "reativar");
            }}
          >
            <Power className="size-3" strokeWidth={2} />
            {isActive ? "Inativar" : "Reativar"}
          </Button>
        ) : null}
      </div>

      {!isActive && row.inactivatedOn ? (
        <span className="text-xs text-muted-foreground">
          desde {formatDate(row.inactivatedOn)}
        </span>
      ) : null}

      {reactivateCritical ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-error-subtle px-1.5 py-0.5 text-xs font-medium text-error-emphasis">
          <AlertTriangle className="size-3.5" strokeWidth={2.5} />
          Reativar — {boxes} box ativo(s)
        </span>
      ) : null}
      {suggestInactivate ? (
        <span className="inline-flex items-center gap-1 text-xs text-warning-emphasis">
          <AlertTriangle className="size-3" strokeWidth={2} />
          sugerir inativar (estação desativada, 0 box)
        </span>
      ) : null}

      {dialog ? (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {dialog === "inativar" ? "Inativar contrato" : "Reativar contrato"}
              </DialogTitle>
              <DialogDescription>
                {dialog === "inativar"
                  ? "O contrato sai do gerar-mês; o último mês é cobrado pró-rata até a data de inativação."
                  : "O contrato volta a ser cobrado no gerar-mês."}
              </DialogDescription>
            </DialogHeader>
            {dialog === "inativar" ? (
              <div className="space-y-3 py-1">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Data de inativação
                  </Label>
                  <DateField value={date} onValueChange={setDate} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Motivo (opcional)</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                variant={dialog === "inativar" ? "destructive" : "default"}
                disabled={pending}
                onClick={() => submit(dialog === "reativar")}
              >
                {dialog === "inativar" ? "Inativar" : "Reativar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

const columns: ColumnDef<ContractRow, unknown>[] = [
  {
    id: "cadastroId",
    header: "Cadastro",
    accessorFn: (r) => r.cadastroId,
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.cadastroId ?? "—"}
      </span>
    ),
  },
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (r) =>
      r.stationExists
        ? `#${r.stationId} ${r.stationName ?? ""}`
        : "sem estação",
    cell: ({ row }) => {
      const r = row.original;
      if (r.stationId === null) {
        return (
          <StatusBadge color="grey" outline>
            Sem estação
          </StatusBadge>
        );
      }
      if (!r.stationExists) {
        return (
          <StatusBadge color={ALERT_TYPE_UI.contract_without_station.color}>
            Estação não encontrada
          </StatusBadge>
        );
      }
      return (
        <Link
          href={`/estacoes/${r.stationId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          <span className="tabular-nums">#{r.stationId}</span>
          {r.stationName ? ` ${r.stationName}` : ""}
        </Link>
      );
    },
  },
  {
    id: "parceiro",
    header: "Parceiro",
    accessorFn: (r) => r.parceiro ?? "",
    cell: ({ row }) =>
      row.original.parceiro ?? (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "contratoAtivo",
    header: "Contrato ativo",
    accessorFn: (r) => (r.status === "ACTIVE" ? "Ativo" : "Inativo"),
    cell: ({ row }) => <ContratoAtivoCell row={row.original} />,
  },
  {
    id: "tipo",
    header: "Tipo de contrato",
    accessorFn: (r) =>
      r.contractType ? CONTRACT_TYPE_UI[r.contractType].label : "",
    cell: ({ row }) => {
      const r = row.original;
      if (!r.contractType) return <span className="text-muted-foreground">—</span>;
      const ui = CONTRACT_TYPE_UI[r.contractType];
      return (
        <div className="flex flex-col gap-0.5">
          <StatusBadge color={ui.color} className="w-fit">
            {ui.label}
          </StatusBadge>
          {r.formula ? (
            <span className="text-xs text-muted-foreground">{r.formula}</span>
          ) : null}
        </div>
      );
    },
    meta: {
      csvValue: (r: ContractRow) =>
        r.contractType
          ? `${CONTRACT_TYPE_UI[r.contractType].label}${r.formula ? ` (${r.formula})` : ""}`
          : "",
    },
  },
  {
    id: "valorMensal",
    header: "Valor mensal",
    accessorFn: (r) => r.valorMensal,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.valorMensal)}
      </span>
    ),
    meta: { csvValue: (r: ContractRow) => r.valorMensal ?? "" },
  },
  {
    id: "dueDay",
    header: "Vencimento",
    accessorFn: (r) => r.dueDay,
    cell: ({ row }) =>
      row.original.dueDay !== null ? (
        <span className="tabular-nums">dia {row.original.dueDay}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "pagamento",
    header: "Pagamento",
    accessorFn: (r) =>
      r.paymentMethod ? PAYMENT_METHOD_LABEL[r.paymentMethod] : "",
    cell: ({ row }) =>
      row.original.paymentMethod ? (
        PAYMENT_METHOD_LABEL[row.original.paymentMethod]
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "contactName",
    header: "Contato",
    accessorFn: (r) => r.contactName ?? "",
    cell: ({ row }) =>
      row.original.contactName ?? (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "phone",
    header: "Telefone",
    accessorFn: (r) => r.phone ?? "",
    cell: ({ row }) =>
      row.original.phone ? (
        <span className="tabular-nums">{row.original.phone}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "email",
    header: "E-mail",
    accessorFn: (r) => r.email ?? "",
    cell: ({ row }) =>
      row.original.email ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "cnpjCpf",
    header: "CNPJ/CPF",
    accessorFn: (r) => r.cnpjCpfMasked ?? "",
    cell: ({ row }) =>
      row.original.cnpjCpfMasked ? (
        <span className="tabular-nums">{row.original.cnpjCpfMasked}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function ContractsTable({ rows }: { rows: ContractRow[] }) {
  const router = useRouter();

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar parceiro, estação, contato…"
      csvFilename="alugueis-contratos"
      initialSorting={[{ id: "cadastroId", desc: false }]}
      initialColumnVisibility={{
        contactName: false,
        phone: false,
        email: false,
        cnpjCpf: false,
      }}
      // Spreadsheet-style header funnels (multi-select checklists).
      filterableColumnIds="all"
      onRowClick={(row) => {
        if (row.cadastroId !== null) router.push(`/alugueis/${row.cadastroId}`);
      }}
      emptyMessage="Nenhum contrato encontrado."
    />
  );
}
