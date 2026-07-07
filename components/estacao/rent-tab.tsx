"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, Home } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  CONTRACT_TYPE_UI,
  PAYMENT_METHOD_LABEL,
  STATION_STATUS_UI,
} from "@/lib/labels";
import { formatBRL, formatDate, formatNumber } from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";
import type { Contract, Counterparty } from "@/lib/domain";

import { EmptyState } from "./empty-state";
import {
  ADJUSTMENT_INDEX_LABEL,
  ADJUSTMENT_STATUS_LABEL,
  formatCnpjCpf,
  monthsUntil,
} from "./helpers";

export function RentTab({
  data,
  fetchedAt,
}: {
  data: Station360;
  fetchedAt: string;
}) {
  const now = new Date(fetchedAt);

  if (data.contracts.length === 0) {
    return (
      <EmptyState
        icon={Home}
        title="Sem contrato"
        description="Esta estação não tem contrato de locação cadastrado."
        action={
          <Button
            variant="outline"
            render={<Link href={`/alugueis/novo?station=${data.station.id}`} />}
          >
            Cadastrar contrato
          </Button>
        }
      />
    );
  }

  const counterpartyByContractId = new Map<string, Counterparty>();
  for (const entry of data.accounts) {
    if (entry.account.contractId && entry.counterparty) {
      counterpartyByContractId.set(entry.account.contractId, entry.counterparty);
    }
  }

  return (
    <div className="space-y-4">
      {data.contracts.map((contract) => (
        <ContractPanel
          key={contract.id}
          contract={contract}
          counterparty={counterpartyByContractId.get(contract.id) ?? null}
          adjustments={data.rentAdjustments.filter(
            (r) => r.contractId === contract.id || r.contractId === null,
          )}
          now={now}
        />
      ))}
    </div>
  );
}

function ContractPanel({
  contract,
  counterparty,
  adjustments,
  now,
}: {
  contract: Contract;
  counterparty: Counterparty | null;
  adjustments: Station360["rentAdjustments"];
  now: Date;
}) {
  const typeUi = contract.contractType
    ? CONTRACT_TYPE_UI[contract.contractType]
    : null;
  const endMonths =
    contract.endsOn !== null ? monthsUntil(contract.endsOn, now) : null;

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{counterparty?.name ?? "Locador não identificado"}</span>
          {typeUi ? (
            <StatusBadge color={typeUi.color}>{typeUi.label}</StatusBadge>
          ) : null}
          {contract.status ? (
            <StatusBadge color={STATION_STATUS_UI[contract.status].color}>
              {STATION_STATUS_UI[contract.status].label}
            </StatusBadge>
          ) : null}
          {endMonths !== null && !Number.isNaN(endMonths) ? (
            endMonths < 0 ? (
              <StatusBadge color="red">Contrato vencido</StatusBadge>
            ) : endMonths <= 6 ? (
              <StatusBadge color="orange">
                Vence em {endMonths} {endMonths === 1 ? "mês" : "meses"}
              </StatusBadge>
            ) : null
          ) : null}
          {contract.cadastroId != null ? (
            <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">
              Cadastro {contract.cadastroId}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="Contato">
            <span className="block">{contract.contactName ?? "—"}</span>
            <span className="block text-xs text-muted-foreground">
              {[contract.phone, contract.email].filter(Boolean).join(" · ") ||
                "—"}
            </span>
          </Field>
          <Field label="CNPJ/CPF">
            <span className="tabular-nums">
              {formatCnpjCpf(counterparty?.cnpjCpf)}
            </span>
          </Field>
          <Field label="Modalidade">
            <ModalityFormula contract={contract} />
          </Field>
          <Field label="Vencimento">
            {contract.dueDay !== null ? (
              <span className="tabular-nums">dia {contract.dueDay}</span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Forma de pagamento">
            {contract.paymentMethod
              ? PAYMENT_METHOD_LABEL[contract.paymentMethod]
              : "—"}
          </Field>
          <Field label="Vigência">
            <span className="tabular-nums">
              {formatDate(contract.startsOn)} — {formatDate(contract.endsOn)}
            </span>
          </Field>
        </dl>

        <BankData contract={contract} />

        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Reajustes
          </h4>
          {adjustments.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhum reajuste registrado.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Negociado em</th>
                    <th className="px-3 py-1.5 font-medium">Índice</th>
                    <th className="px-3 py-1.5 text-right font-medium">%</th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      Valor antigo
                    </th>
                    <th className="px-3 py-1.5 text-right font-medium">
                      Valor novo
                    </th>
                    <th className="px-3 py-1.5 font-medium">Vigência</th>
                    <th className="px-3 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((adj) => (
                    <tr key={adj.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 tabular-nums">
                        {formatDate(adj.negotiatedOn)}
                      </td>
                      <td className="px-3 py-1.5">
                        {ADJUSTMENT_INDEX_LABEL[adj.indexType]}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {adj.indexPct !== null
                          ? `${formatNumber(adj.indexPct)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatBRL(adj.oldAmount)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatBRL(adj.newAmount)}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {formatDate(adj.effectiveFrom)}
                      </td>
                      <td className="px-3 py-1.5">
                        {ADJUSTMENT_STATUS_LABEL[adj.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {contract.observations ? (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">
              Observações
            </h4>
            <p className="text-sm whitespace-pre-line">
              {contract.observations}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Pricing formula rendered per Tipo_Contrato (spec §3 Aluguel). */
function ModalityFormula({ contract }: { contract: Contract }) {
  const { contractType, boxCount, minBox, valorPorBox, valorMensal } = contract;
  switch (contractType) {
    case "por_box":
      return (
        <span className="tabular-nums">
          {formatNumber(boxCount)} × {formatBRL(valorPorBox)} ={" "}
          <strong>{formatBRL(valorMensal)}</strong>
        </span>
      );
    case "por_box_minimo":
      return (
        <span className="tabular-nums">
          MAX({formatNumber(boxCount)}; {formatNumber(minBox)}) ×{" "}
          {formatBRL(valorPorBox)} = <strong>{formatBRL(valorMensal)}</strong>
        </span>
      );
    case "fixo":
      return (
        <span className="tabular-nums">
          Fixo: <strong>{formatBRL(valorMensal)}</strong>
        </span>
      );
    case "gratuito":
      return <span>Sem custo</span>;
    case "casa_vammo":
      return <span>Casa Vammo</span>;
    default:
      return <span>—</span>;
  }
}

/**
 * Bank data masked by default with reveal-on-click.
 * TODO Phase 2: audit each reveal (goBuy finance.request_events pattern) —
 * no audit trail exists in Phase 1's read-only sheet snapshot.
 */
function BankData({ contract }: { contract: Contract }) {
  const [revealed, setRevealed] = React.useState(false);
  const fields: Array<[string, string | null]> = [
    ["Banco", contract.banco],
    ["Agência", contract.agencia],
    ["Conta", contract.conta],
    ["Chave Pix", contract.chavePix],
  ];
  const hasAny = fields.some(([, v]) => v !== null && v !== "");
  if (!hasAny) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          Dados bancários
        </h4>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
        >
          {revealed ? (
            <EyeOff className="size-3.5" strokeWidth={2} aria-hidden />
          ) : (
            <Eye className="size-3.5" strokeWidth={2} aria-hidden />
          )}
          {revealed ? "Ocultar" : "Revelar"}
        </Button>
      </div>
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        {fields.map(([label, value]) =>
          value ? (
            <Field key={label} label={label}>
              <span className="font-mono tabular-nums">
                {revealed ? value : maskValue(value)}
              </span>
            </Field>
          ) : null,
        )}
      </dl>
    </div>
  );
}

function maskValue(value: string): string {
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.min(value.length - 4, 10))}${value.slice(-2)}`;
}
