"use client";

/**
 * Email-classification review queue (R2, requirement 4): lists every
 * `needs_review` charge the n8n webhook (or a clone-era UNIDENTIFIED row) left
 * for a human, with a PDF-proxy link and a reclassify dialog. "Aprovar como
 * está" accepts the classification; "Revisar" opens the full editor. Both call
 * the `reclassify_charge` RPC through the server actions.
 */

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, PencilLine } from "lucide-react";

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
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { approveCobranca, reclassifyCharge } from "@/app/actions/cobrancas";
import { CHARGE_KIND_UI, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatBRL, formatCompetencia } from "@/lib/format";
import type { ChargeKind, PaymentMethod } from "@/lib/domain";

import type {
  CadastroOption,
  MergeTargetRow,
  ReviewChargeRow,
  StationOption,
} from "@/app/(app)/revisao/cobrancas/queries";
import { buildUnifyProposals } from "./unify-proposals";
import { UnifyProposalsPanel } from "./unify-proposals-panel";

const KIND_OPTIONS: ChargeKind[] = ["aluguel", "energia", "aluguel_energia"];
const PAYMENT_OPTIONS: PaymentMethod[] = [
  "pix",
  "transferencia",
  "boleto_email",
  "boleto_celular",
  "debito_automatico",
  "outro",
];

function moneyToNumber(raw: string): number | null {
  const t = raw.trim().replace(/[r$\s]/gi, "");
  if (t === "") return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

export function CobrancasReview({
  rows,
  stations,
  cadastros,
  mergeTargets,
  available,
}: {
  rows: ReviewChargeRow[];
  stations: StationOption[];
  cadastros: CadastroOption[];
  mergeTargets: MergeTargetRow[];
  available: boolean;
}) {
  const [editing, setEditing] = React.useState<ReviewChargeRow | null>(null);
  const { run, pending } = useRunAction();
  const proposals = React.useMemo(
    () => buildUnifyProposals(rows, mergeTargets),
    [rows, mergeTargets],
  );

  const columns = React.useMemo<ColumnDef<ReviewChargeRow, unknown>[]>(
    () => [
      {
        id: "competencia",
        header: "Competência",
        accessorFn: (r) => r.competencia ?? "",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCompetencia(row.original.competencia)}
          </span>
        ),
      },
      {
        id: "tipo",
        header: "Tipo",
        accessorFn: (r) => CHARGE_KIND_UI[r.kind].label,
        cell: ({ row }) => {
          const ui = CHARGE_KIND_UI[row.original.kind];
          return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
        },
      },
      {
        id: "alvo",
        header: "Estação / parceiro",
        accessorFn: (r) => r.stationName ?? r.parceiro ?? "",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="text-sm">
              {r.stationId !== null ? (
                <span className="font-medium">
                  #{r.stationId} {r.stationName ?? ""}
                </span>
              ) : r.parceiro ? (
                r.parceiro
              ) : (
                <span className="text-muted-foreground">sem atribuição</span>
              )}
              {r.cadastroId !== null ? (
                <span className="block text-xs text-muted-foreground">
                  cadastro {r.cadastroId}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "valor",
        header: "Valor",
        accessorFn: (r) => r.amount ?? Number.MIN_SAFE_INTEGER,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="block text-right tabular-nums">
              <span className="font-medium">{formatBRL(r.amount)}</span>
              {r.expectedAmount !== null && r.expectedAmount !== r.amount ? (
                <span className="block text-xs text-muted-foreground">
                  previsto {formatBRL(r.expectedAmount)}
                </span>
              ) : null}
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
                onClick={() =>
                  run(() => approveCobranca(r.id, r.kind), {
                    success: "Classificação aprovada",
                  })
                }
              >
                Aprovar
              </Button>
              <Button
                size="sm"
                disabled={!available}
                onClick={() => setEditing(r)}
              >
                <PencilLine className="size-4" strokeWidth={2} />
                Revisar
              </Button>
            </div>
          );
        },
      },
    ],
    [run, pending, available],
  );

  return (
    <>
      <UnifyProposalsPanel proposals={proposals} available={available} />
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Buscar cobrança, parceiro, estação…"
        csvFilename="cobrancas-revisao"
        initialSorting={[{ id: "competencia", desc: true }]}
        filterableColumnIds="all"
        emptyMessage={
          available
            ? "Nenhuma cobrança aguardando revisão."
            : "Fila indisponível — backend Supabase não configurado."
        }
      />
      {editing ? (
        <ReclassifyDialog
          row={editing}
          stations={stations}
          cadastros={cadastros}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function ReclassifyDialog({
  row,
  stations,
  cadastros,
  onClose,
}: {
  row: ReviewChargeRow;
  stations: StationOption[];
  cadastros: CadastroOption[];
  onClose: () => void;
}) {
  const { run, pending } = useRunAction();
  const [kind, setKind] = React.useState<ChargeKind>(row.kind);
  const [competencia, setCompetencia] = React.useState(
    row.competencia ? row.competencia.slice(0, 7) : "",
  );
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

  async function save() {
    const ok = await run(
      () =>
        reclassifyCharge({
          chargeId: row.id,
          kind,
          competencia: competencia || null,
          amount: moneyToNumber(amount),
          expectedAmount: moneyToNumber(expected),
          energyAmount: isEnergyBearing ? moneyToNumber(energy) : null,
          cadastroId: isRentBearing && cadastroId ? Number(cadastroId) : null,
          stationId: stationId ? Number(stationId) : null,
          counterpartyName: isEnergyBearing ? cpName || null : null,
          counterpartyCnpj: isEnergyBearing ? cpCnpj || null : null,
          paymentMethod: (method || null) as PaymentMethod | null,
          banco: banco || null,
          agencia: agencia || null,
          conta: conta || null,
          chavePix: chavePix || null,
          codigoBoleto: codigoBoleto || null,
          notes: notes || null,
        }),
      { success: "Cobrança reclassificada" },
    );
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar classificação</DialogTitle>
          <DialogDescription>
            Confira e corrija a classificação feita pelo e-mail/IA. Ao salvar, a
            cobrança sai da fila de revisão.
          </DialogDescription>
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
          <Field label="Banco">
            <Input value={banco} onChange={(e) => setBanco(e.target.value)} />
          </Field>
          <Field label="Agência">
            <Input value={agencia} onChange={(e) => setAgencia(e.target.value)} />
          </Field>
          <Field label="Conta">
            <Input value={conta} onChange={(e) => setConta(e.target.value)} />
          </Field>
          <Field label="Chave Pix">
            <Input value={chavePix} onChange={(e) => setChavePix(e.target.value)} />
          </Field>
          <Field label="Código do boleto">
            <Input
              value={codigoBoleto}
              onChange={(e) => setCodigoBoleto(e.target.value)}
              placeholder="linha digitável"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Observações">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            Salvar reclassificação
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
