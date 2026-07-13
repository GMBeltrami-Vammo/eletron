"use client";

/**
 * Shared cobrança editor (extracted from /revisão/cobranças' ReclassifyDialog,
 * decisão #47) — used by the review queue AND the /pagamentos "Documentos de
 * e-mail" staging tab. Saving calls the reclassify_charge RPC, which flips
 * match_status → manually_matched (leaves both review surfaces).
 *
 * Payment-instrument fields are CONDITIONAL on the forma de pagamento
 * (requirement: transferência → banco/agência/conta; pix → chave;
 * boleto → linha digitável). Known pre-existing limitation: the RPC coalesces
 * nulls, so switching pix→boleto cannot CLEAR the stale chave_pix — it just
 * stops being shown/edited here.
 */

import * as React from "react";

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
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { visiblePaymentFields } from "@/components/cobrancas/payment-fields";
import { reclassifyCharge } from "@/app/actions/cobrancas";
import { CHARGE_KIND_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import type { ChargeKind, PaymentMethod } from "@/lib/domain";

import type {
  CadastroOption,
  ReviewChargeRow,
  StationOption,
} from "@/app/(app)/revisao/cobrancas/queries";

export const KIND_OPTIONS: ChargeKind[] = ["aluguel", "energia", "aluguel_energia"];
export const PAYMENT_OPTIONS: PaymentMethod[] = [
  "pix",
  "transferencia",
  "boleto_email",
  "boleto_celular",
  "debito_automatico",
  "outro",
];

export function moneyToNumber(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

export function ChargeEditorDialog({
  row,
  stations,
  cadastros,
  onClose,
  title = "Revisar classificação",
  description = "Confira e corrija a classificação feita pelo e-mail/IA. Ao salvar, a cobrança sai da fila de revisão.",
}: {
  row: ReviewChargeRow;
  stations: StationOption[];
  cadastros: CadastroOption[];
  onClose: () => void;
  title?: string;
  description?: string;
}) {
  const { run, pending } = useRunAction();
  const [kind, setKind] = React.useState<ChargeKind>(row.kind);
  const [competencia, setCompetencia] = React.useState(
    row.competencia ? row.competencia.slice(0, 7) : "",
  );
  const [dueDate, setDueDate] = React.useState(row.dueDate ?? "");
  const [amount, setAmount] = React.useState(row.amount != null ? String(row.amount) : "");
  const [expected, setExpected] = React.useState(
    row.expectedAmount != null ? String(row.expectedAmount) : "",
  );
  const [energy, setEnergy] = React.useState(
    row.energyLineAmount != null ? String(row.energyLineAmount) : "",
  );
  const [cadastroId, setCadastroId] = React.useState(
    row.cadastroId != null ? String(row.cadastroId) : "",
  );
  const [stationId, setStationId] = React.useState(
    row.stationId != null ? String(row.stationId) : "",
  );
  const [cpName, setCpName] = React.useState(row.parceiro ?? "");
  const [cpCnpj, setCpCnpj] = React.useState(row.issuerCnpj ?? "");
  const [method, setMethod] = React.useState<string>(row.paymentMethod ?? "");
  const [banco, setBanco] = React.useState(row.banco ?? "");
  const [agencia, setAgencia] = React.useState(row.agencia ?? "");
  const [conta, setConta] = React.useState(row.conta ?? "");
  const [chavePix, setChavePix] = React.useState(row.chavePix ?? "");
  const [codigoBoleto, setCodigoBoleto] = React.useState(row.linhaDigitavel ?? "");
  const [notes, setNotes] = React.useState(row.notes ?? "");

  const isEnergyBearing = kind === "energia" || kind === "aluguel_energia";
  const isRentBearing = kind === "aluguel" || kind === "aluguel_energia";
  const paymentFields = visiblePaymentFields(method as PaymentMethod | "");

  async function save() {
    const ok = await run(
      () =>
        reclassifyCharge({
          chargeId: row.id,
          kind,
          competencia: competencia || null,
          dueDate: dueDate || null,
          amount: moneyToNumber(amount),
          expectedAmount: moneyToNumber(expected),
          energyAmount: isEnergyBearing ? moneyToNumber(energy) : null,
          cadastroId: isRentBearing && cadastroId ? Number(cadastroId) : null,
          stationId: stationId ? Number(stationId) : null,
          counterpartyName: isEnergyBearing ? cpName || null : null,
          counterpartyCnpj: isEnergyBearing ? cpCnpj || null : null,
          paymentMethod: (method || null) as PaymentMethod | null,
          // hidden groups send null — the RPC coalesces (keeps existing value)
          banco: paymentFields.includes("banco_agencia_conta") ? banco || null : null,
          agencia: paymentFields.includes("banco_agencia_conta") ? agencia || null : null,
          conta: paymentFields.includes("banco_agencia_conta") ? conta || null : null,
          chavePix: paymentFields.includes("chave_pix") ? chavePix || null : null,
          codigoBoleto: paymentFields.includes("codigo_boleto")
            ? codigoBoleto || null
            : null,
          notes: notes || null,
        }),
      { success: "Cobrança atualizada" },
    );
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Tipo de cobrança">
            <Select value={kind} onValueChange={(v) => setKind(v as ChargeKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CHARGE_KIND_UI[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Competência">
            <Input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </Field>

          <Field label="Valor (documento)">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Valor previsto (planilha)">
            <Input
              inputMode="decimal"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="opcional"
            />
          </Field>

          {isEnergyBearing ? (
            <Field label="Valor de energia (rateio)">
              <Input
                inputMode="decimal"
                value={energy}
                onChange={(e) => setEnergy(e.target.value)}
                placeholder="linha de energia"
              />
            </Field>
          ) : null}

          <Field label="Estação">
            <Select
              value={stationId || "none"}
              onValueChange={(v) => setStationId(v === "none" ? "" : (v as string))}
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

          {isRentBearing ? (
            <Field label="Cadastro (contrato)">
              <Select
                value={cadastroId || "none"}
                onValueChange={(v) => setCadastroId(v === "none" ? "" : (v as string))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="sem cadastro" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cadastro</SelectItem>
                  {cadastros.map((c) => (
                    <SelectItem key={c.cadastroId} value={String(c.cadastroId)}>
                      {c.cadastroId} — {c.parceiro ?? "sem parceiro"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {isEnergyBearing ? (
            <>
              <Field label="Parceiro (terceiro)">
                <Input value={cpName} onChange={(e) => setCpName(e.target.value)} />
              </Field>
              <Field label="CNPJ/CPF do parceiro">
                <Input
                  value={cpCnpj}
                  onChange={(e) => setCpCnpj(e.target.value)}
                  placeholder="somente dígitos"
                />
              </Field>
            </>
          ) : null}

          <Field label="Forma de pagamento">
            <Select
              value={method || "none"}
              onValueChange={(v) => setMethod(v === "none" ? "" : (v as string))}
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
          <Field label="Vencimento">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>

          {paymentFields.includes("banco_agencia_conta") ? (
            <>
              <Field label="Banco">
                <Input value={banco} onChange={(e) => setBanco(e.target.value)} />
              </Field>
              <Field label="Agência">
                <Input value={agencia} onChange={(e) => setAgencia(e.target.value)} />
              </Field>
              <Field label="Conta">
                <Input value={conta} onChange={(e) => setConta(e.target.value)} />
              </Field>
            </>
          ) : null}
          {paymentFields.includes("chave_pix") ? (
            <Field label="Chave Pix">
              <Input value={chavePix} onChange={(e) => setChavePix(e.target.value)} />
            </Field>
          ) : null}
          {paymentFields.includes("codigo_boleto") ? (
            <Field label="Código do boleto">
              <Input
                value={codigoBoleto}
                onChange={(e) => setCodigoBoleto(e.target.value)}
                placeholder="linha digitável"
              />
            </Field>
          ) : null}

          <HiddenInstruments row={row} visible={paymentFields} />

          <div className="sm:col-span-2">
            <Field label="Observações">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </Field>
          </div>

          <p className="text-xs text-muted-foreground sm:col-span-2">
            Campos deixados em branco mantêm o valor atual da cobrança.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The conditional fields hide instrument groups the chosen método doesn't use —
 * but the AI may have EXTRACTED a value into a hidden group (e.g. a linha
 * digitável on a row whose método is still unset). Show those read-only so the
 * reviewer can verify the extraction against the PDF without guess-selecting a
 * método first. The RPC coalesce never loses these values.
 */
function HiddenInstruments({
  row,
  visible,
}: {
  row: ReviewChargeRow;
  visible: string[];
}) {
  const hidden: { label: string; value: string }[] = [];
  if (!visible.includes("codigo_boleto") && row.linhaDigitavel) {
    hidden.push({ label: "Código do boleto", value: row.linhaDigitavel });
  }
  if (!visible.includes("chave_pix") && row.chavePix) {
    hidden.push({ label: "Chave Pix", value: row.chavePix });
  }
  if (!visible.includes("banco_agencia_conta")) {
    const conta = [row.banco, row.agencia, row.conta].filter(Boolean).join(" / ");
    if (conta) hidden.push({ label: "Banco / agência / conta", value: conta });
  }
  if (hidden.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs sm:col-span-2">
      <p className="mb-1 font-medium text-muted-foreground">
        Extraído do documento (selecione a forma de pagamento correspondente para editar):
      </p>
      {hidden.map((h) => (
        <p key={h.label} className="truncate font-mono" title={h.value}>
          <span className="font-sans text-muted-foreground">{h.label}: </span>
          {h.value}
        </p>
      ))}
    </div>
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
