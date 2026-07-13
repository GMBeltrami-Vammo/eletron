"use client";

/**
 * Shared contract-intake edit form (decisão #48) — the ~20 editable fields that
 * confirm a staged intake into a real contract, extracted from the /revisão
 * ConfirmDialog so BOTH surfaces reuse one form:
 *   - /revisão › Contratos  → wrapped in a Dialog (ConfirmDialog)
 *   - /alugueis/novo         → rendered inline, PDF first page side-by-side
 * Owns its own field state (seeded from `prefill`) + the confirm call; the
 * caller supplies the container, an optional Cancel, and the onConfirmed hook.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
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
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { confirmContractIntake } from "@/app/actions/contracts";
import {
  CONTRACT_TYPE_UI,
  PAYMENT_METHOD_LABEL,
  STATION_STATUS_UI,
} from "@/lib/labels";
import { CONTRACT_TYPE, PAYMENT_METHOD, STATION_STATUS } from "@/lib/domain";
import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";

import type { ContractIntakePrefill } from "@/lib/ingest/contratos";
import type { StationOption } from "@/app/(app)/revisao/contratos/queries";

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

export function ContractIntakeFields({
  intakeId,
  prefill,
  stations,
  onConfirmed,
  onCancel,
  cancelLabel = "Cancelar",
  confirmLabel = "Confirmar e criar contrato",
}: {
  intakeId: string;
  prefill: ContractIntakePrefill;
  stations: StationOption[];
  onConfirmed: (contractId: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
}) {
  const { run, pending } = useRunAction();
  const [contractType, setContractType] = React.useState<string>(prefill.contractType ?? "");
  const [status, setStatus] = React.useState<StationStatus>(prefill.status);
  const [stationId, setStationId] = React.useState(
    prefill.swapStationId != null ? String(prefill.swapStationId) : "",
  );
  const [cpName, setCpName] = React.useState(prefill.counterpartyName ?? "");
  const [cpCnpj, setCpCnpj] = React.useState(prefill.counterpartyCnpj ?? "");
  const [numeroConexao, setNumeroConexao] = React.useState(prefill.numeroConexao ?? "");
  const [endereco, setEndereco] = React.useState(prefill.endereco ?? "");
  const [contato, setContato] = React.useState(prefill.contato ?? "");
  const [telefone, setTelefone] = React.useState(prefill.telefone ?? "");
  const [email, setEmail] = React.useState(prefill.email ?? "");
  const [boxCount, setBoxCount] = React.useState(
    prefill.boxCount != null ? String(prefill.boxCount) : "",
  );
  const [minBox, setMinBox] = React.useState(prefill.minBox != null ? String(prefill.minBox) : "");
  const [valorPorBox, setValorPorBox] = React.useState(
    prefill.valorPorBox != null ? String(prefill.valorPorBox) : "",
  );
  const [valorMensal, setValorMensal] = React.useState(
    prefill.valorMensal != null ? String(prefill.valorMensal) : "",
  );
  const [dueDay, setDueDay] = React.useState(prefill.dueDay != null ? String(prefill.dueDay) : "");
  const [method, setMethod] = React.useState<string>(prefill.paymentMethod ?? "");
  const [banco, setBanco] = React.useState(prefill.banco ?? "");
  const [agencia, setAgencia] = React.useState(prefill.agencia ?? "");
  const [conta, setConta] = React.useState(prefill.conta ?? "");
  const [chavePix, setChavePix] = React.useState(prefill.chavePix ?? "");
  const [observacoes, setObservacoes] = React.useState(prefill.observacoes ?? "");

  const canConfirm = contractType !== "" && (cpName.trim() !== "" || cpCnpj.trim() !== "");
  const isPerBox = contractType === "por_box" || contractType === "por_box_minimo";
  const isFixed = contractType === "fixo";

  async function save() {
    const result = await run(
      () =>
        confirmContractIntake({
          intakeId,
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
    // useRunAction returns boolean; the created id is fetched via router refresh
    // on the caller. We only need success to advance the flow.
    if (result) onConfirmed(intakeId);
  }

  return (
    <div>
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

        {isPerBox || isFixed ? (
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
            <Input inputMode="numeric" value={minBox} onChange={(e) => setMinBox(e.target.value)} />
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
            <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel ? (
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
        ) : null}
        <Button onClick={save} disabled={pending || !canConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
