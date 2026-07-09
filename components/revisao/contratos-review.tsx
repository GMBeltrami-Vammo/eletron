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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/vammo/data-table";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import {
  confirmContractIntake,
  rejectContractIntake,
} from "@/app/actions/contracts";
import {
  CONTRACT_TYPE_UI,
  PAYMENT_METHOD_LABEL,
  STATION_STATUS_UI,
} from "@/lib/labels";
import { CONTRACT_TYPE, PAYMENT_METHOD, STATION_STATUS } from "@/lib/domain";
import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";

import type {
  ContratoIntakeRow,
  StationOption,
} from "@/app/(app)/revisao/contratos/queries";

const CONTRACT_TYPE_OPTIONS: ContractType[] = [
  CONTRACT_TYPE.porBox,
  CONTRACT_TYPE.porBoxMinimo,
  CONTRACT_TYPE.fixo,
  CONTRACT_TYPE.gratuito,
  CONTRACT_TYPE.casaVammo,
];
const STATUS_OPTIONS: StationStatus[] = [
  STATION_STATUS.ACTIVE,
  STATION_STATUS.PRE_INSTALLATION,
  STATION_STATUS.INACTIVE,
  STATION_STATUS.DECOMMISSIONED,
];
const PAYMENT_OPTIONS: PaymentMethod[] = [
  PAYMENT_METHOD.pix,
  PAYMENT_METHOD.transferencia,
  PAYMENT_METHOD.boletoEmail,
  PAYMENT_METHOD.boletoCelular,
  PAYMENT_METHOD.debitoAutomatico,
  PAYMENT_METHOD.outro,
];

function moneyToNumber(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number.parseInt(t, 10);
  return Number.isInteger(n) ? n : null;
}

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
  const { run, pending } = useRunAction();
  const [contractType, setContractType] = React.useState<string>(row.contractType ?? "");
  const [status, setStatus] = React.useState<StationStatus>(row.status);
  const [stationId, setStationId] = React.useState(
    row.swapStationId != null ? String(row.swapStationId) : "",
  );
  const [cpName, setCpName] = React.useState(row.counterpartyName ?? "");
  const [cpCnpj, setCpCnpj] = React.useState(row.counterpartyCnpj ?? "");
  const [numeroConexao, setNumeroConexao] = React.useState(row.numeroConexao ?? "");
  const [endereco, setEndereco] = React.useState(row.endereco ?? "");
  const [contato, setContato] = React.useState(row.contato ?? "");
  const [telefone, setTelefone] = React.useState(row.telefone ?? "");
  const [email, setEmail] = React.useState(row.email ?? "");
  const [boxCount, setBoxCount] = React.useState(row.boxCount != null ? String(row.boxCount) : "");
  const [minBox, setMinBox] = React.useState(row.minBox != null ? String(row.minBox) : "");
  const [valorPorBox, setValorPorBox] = React.useState(
    row.valorPorBox != null ? String(row.valorPorBox) : "",
  );
  const [valorMensal, setValorMensal] = React.useState(
    row.valorMensal != null ? String(row.valorMensal) : "",
  );
  const [dueDay, setDueDay] = React.useState(row.dueDay != null ? String(row.dueDay) : "");
  const [method, setMethod] = React.useState<string>(row.paymentMethod ?? "");
  const [banco, setBanco] = React.useState(row.banco ?? "");
  const [agencia, setAgencia] = React.useState(row.agencia ?? "");
  const [conta, setConta] = React.useState(row.conta ?? "");
  const [chavePix, setChavePix] = React.useState(row.chavePix ?? "");
  const [observacoes, setObservacoes] = React.useState(row.observacoes ?? "");

  const canConfirm =
    contractType !== "" && (cpName.trim() !== "" || cpCnpj.trim() !== "");

  async function save() {
    const ok = await run(
      () =>
        confirmContractIntake({
          intakeId: row.id,
          swapStationId: stationId ? Number(stationId) : null,
          status,
          contractType: contractType as ContractType,
          counterpartyName: cpName.trim() || null,
          counterpartyCnpj: cpCnpj.trim() || null,
          numeroConexao: numeroConexao.trim() || null,
          endereco: endereco.trim() || null,
          contato: contato.trim() || null,
          telefone: telefone.trim() || null,
          email: email.trim() || null,
          boxCount: intOrNull(boxCount),
          minBox: intOrNull(minBox),
          valorPorBox: moneyToNumber(valorPorBox),
          valorMensal: moneyToNumber(valorMensal),
          dueDay: intOrNull(dueDay),
          paymentMethod: (method || null) as PaymentMethod | null,
          banco: banco.trim() || null,
          agencia: agencia.trim() || null,
          conta: conta.trim() || null,
          chavePix: chavePix.trim() || null,
          observacoes: observacoes.trim() || null,
        }),
      { success: "Contrato criado" },
    );
    if (ok) onClose();
  }

  const isPerBox = contractType === "por_box" || contractType === "por_box_minimo";
  const isFixed = contractType === "fixo";

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

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Tipo de contrato *">
            <Select value={contractType} onValueChange={(v) => setContractType(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="selecione" />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CONTRACT_TYPE_UI[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status da locação">
            <Select value={status} onValueChange={(v) => v && setStatus(v as StationStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATION_STATUS_UI[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Estação">
            <Select
              value={stationId || "none"}
              onValueChange={(v) => setStationId(!v || v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="sem estação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem estação</SelectItem>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    #{s.id} {s.name ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nº da conexão (Enel)">
            <Input value={numeroConexao} onChange={(e) => setNumeroConexao(e.target.value)} />
          </Field>

          <Field label="Parceiro locador *">
            <Input value={cpName} onChange={(e) => setCpName(e.target.value)} />
          </Field>
          <Field label="CNPJ/CPF">
            <Input
              value={cpCnpj}
              onChange={(e) => setCpCnpj(e.target.value)}
              placeholder="somente dígitos"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Endereço">
              <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} />
            </Field>
          </div>

          <Field label="Contato">
            <Input value={contato} onChange={(e) => setContato(e.target.value)} />
          </Field>
          <Field label="Telefone">
            <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </Field>
          <Field label="E-mail">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Dia de vencimento">
            <Input
              inputMode="numeric"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              placeholder="1–31"
            />
          </Field>

          {(isPerBox || isFixed) ? (
            <Field label="Nº de boxes">
              <Input
                inputMode="numeric"
                value={boxCount}
                onChange={(e) => setBoxCount(e.target.value)}
              />
            </Field>
          ) : null}
          {contractType === "por_box_minimo" ? (
            <Field label="Mínimo de boxes">
              <Input
                inputMode="numeric"
                value={minBox}
                onChange={(e) => setMinBox(e.target.value)}
              />
            </Field>
          ) : null}
          {isPerBox ? (
            <Field label="Valor por box">
              <Input
                inputMode="decimal"
                value={valorPorBox}
                onChange={(e) => setValorPorBox(e.target.value)}
                placeholder="0,00"
              />
            </Field>
          ) : null}
          {isFixed ? (
            <Field label="Valor mensal">
              <Input
                inputMode="decimal"
                value={valorMensal}
                onChange={(e) => setValorMensal(e.target.value)}
                placeholder="0,00"
              />
            </Field>
          ) : null}

          <Field label="Forma de pagamento">
            <Select
              value={method || "none"}
              onValueChange={(v) => setMethod(!v || v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="não informado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não informado</SelectItem>
                {PAYMENT_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Chave Pix">
            <Input value={chavePix} onChange={(e) => setChavePix(e.target.value)} />
          </Field>
          <Field label="Banco">
            <Input value={banco} onChange={(e) => setBanco(e.target.value)} />
          </Field>
          <Field label="Agência">
            <Input value={agencia} onChange={(e) => setAgencia(e.target.value)} />
          </Field>
          <Field label="Conta">
            <Input value={conta} onChange={(e) => setConta(e.target.value)} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Observações">
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending || !canConfirm}>
            Confirmar e criar contrato
          </Button>
        </DialogFooter>
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
