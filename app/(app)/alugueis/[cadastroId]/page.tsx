import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BatteryCharging } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/vammo/page-header";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { StatusBadge } from "@/components/vammo/status-badge";
import { BankDataReveal } from "@/components/alugueis/bank-data";
import {
  contractEndInfo,
  contractFormulaSummary,
  EndsChip,
  Field,
  formatCnpjCpf,
} from "@/components/alugueis/contract-utils";
import {
  RentChargesTable,
  type RentChargeRow,
} from "@/components/alugueis/rent-charges-table";
import { getRepository } from "@/lib/data/repository.server";
import { readPaymentLinks, summarizeLinks } from "@/lib/data/payment-links";
import { ContractAlterations } from "@/components/alugueis/contract-alterations";
import { readContractRef } from "./contract-ref";
import { formatBRL, formatDate } from "@/lib/format";
import {
  ALERT_TYPE_UI,
  CONTRACT_TYPE_UI,
  PAYMENT_METHOD_LABEL,
  STATION_STATUS_UI,
} from "@/lib/labels";

export const metadata = { title: "Contrato" };

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ cadastroId: string }>;
}) {
  const { cadastroId: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const repo = getRepository();
  const [snapshot, links, contractRef] = await Promise.all([
    repo.getSnapshot(),
    readPaymentLinks(),
    readContractRef(id),
  ]);
  const contract = snapshot.contracts.find((c) => c.cadastroId === id);
  if (!contract) notFound();

  const counterparty = contract.counterpartyId
    ? (snapshot.counterparties.find((c) => c.id === contract.counterpartyId) ??
      null)
    : null;
  const station =
    contract.stationId !== null
      ? (snapshot.stations.find((s) => s.id === contract.stationId) ?? null)
      : null;

  const accountIds = new Set(
    snapshot.billingAccounts
      .filter((a) => a.contractId === contract.id)
      .map((a) => a.id),
  );
  const chargeRows: RentChargeRow[] = snapshot.charges
    .filter(
      (c) => c.billingAccountId !== null && accountIds.has(c.billingAccountId),
    )
    .sort((a, b) => (b.competencia ?? "").localeCompare(a.competencia ?? ""))
    .map((c) => ({
      id: c.id,
      competencia: c.competencia,
      amount: c.amount,
      status: c.status,
      source: c.source,
      matchStatus: c.matchStatus,
      payment: summarizeLinks(
        links.byDedupeKey.get(c.dedupeKey) ?? links.byChargeUuid.get(c.id),
      ),
    }));

  const endInfo = contractEndInfo(contract.endsOn, new Date());
  const typeUi = contract.contractType
    ? CONTRACT_TYPE_UI[contract.contractType]
    : null;
  const statusUi = contract.status ? STATION_STATUS_UI[contract.status] : null;

  return (
    <div>
      <PageHeader
        title={`Contrato #${id}${counterparty?.name ? ` — ${counterparty.name}` : ""}`}
        description={contract.address ?? undefined}
        actions={
          <>
            <Button variant="outline" render={<Link href="/alugueis" />}>
              <ArrowLeft className="size-4" strokeWidth={2} />
              Voltar
            </Button>
            {station ? (
              <Button
                variant="outline"
                render={<Link href={`/estacoes/${station.id}`} />}
              >
                <BatteryCharging className="size-4" strokeWidth={2} />
                Ver estação
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {statusUi ? (
          <StatusBadge color={statusUi.color}>{statusUi.label}</StatusBadge>
        ) : null}
        {typeUi ? (
          <StatusBadge color={typeUi.color}>{typeUi.label}</StatusBadge>
        ) : null}
        <EndsChip info={endInfo} />
        {contract.rentManual ? (
          <StatusBadge color="blue">Cobrança manual</StatusBadge>
        ) : null}
        <FreshnessDot
          label="Planilha de aluguéis"
          timestamp={snapshot.fetchedAt}
          warnHours={1}
          criticalHours={3}
          className="ml-auto"
        />
      </div>

      {contractRef ? (
        <div className="mb-4">
          <ContractAlterations
            contractUuid={contractRef.uuid}
            cadastroId={id}
            rentManual={contractRef.rentManual}
            status={contractRef.status}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contrato</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Modalidade">
                {typeUi ? (
                  <span className="flex flex-col gap-0.5">
                    <StatusBadge color={typeUi.color} className="w-fit">
                      {typeUi.label}
                    </StatusBadge>
                    {contractFormulaSummary(contract) ? (
                      <span className="text-xs text-muted-foreground">
                        {contractFormulaSummary(contract)}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Valor mensal">
                <span className="font-semibold tabular-nums">
                  {formatBRL(contract.valorMensal)}
                </span>
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
              <Field label="Início">
                <span className="tabular-nums">
                  {formatDate(contract.startsOn)}
                </span>
              </Field>
              <Field label="Fim">
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">
                    {formatDate(contract.endsOn)}
                  </span>
                  <EndsChip info={endInfo} />
                </span>
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parceiro e contato</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Parceiro">{counterparty?.name ?? "—"}</Field>
              <Field label="CNPJ/CPF">
                <span className="tabular-nums">
                  {formatCnpjCpf(counterparty?.cnpjCpf)}
                </span>
              </Field>
              <Field label="Contato">{contract.contactName ?? "—"}</Field>
              <Field label="Telefone">
                <span className="tabular-nums">{contract.phone ?? "—"}</span>
              </Field>
              <Field label="E-mail">
                <span className="break-all">{contract.email ?? "—"}</span>
              </Field>
              <Field label="Endereço">{contract.address ?? "—"}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dados bancários</CardTitle>
          </CardHeader>
          <CardContent>
            <BankDataReveal
              banco={contract.banco}
              agencia={contract.agencia}
              conta={contract.conta}
              chavePix={contract.chavePix}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estação</CardTitle>
          </CardHeader>
          <CardContent>
            {station ? (
              <div className="space-y-2">
                <Link
                  href={`/estacoes/${station.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  <span className="tabular-nums">#{station.id}</span>
                  {station.name ? ` — ${station.name}` : ""}
                </Link>
                {station.address ? (
                  <p className="text-sm text-muted-foreground">
                    {station.address}
                  </p>
                ) : null}
                {station.status ? (
                  <StatusBadge color={STATION_STATUS_UI[station.status].color}>
                    {STATION_STATUS_UI[station.status].label}
                  </StatusBadge>
                ) : null}
              </div>
            ) : contract.stationId !== null ? (
              <div className="space-y-2">
                <StatusBadge
                  color={ALERT_TYPE_UI.contract_without_station.color}
                >
                  Estação não encontrada
                </StatusBadge>
                <p className="text-sm text-muted-foreground">
                  O contrato aponta para a estação{" "}
                  <span className="tabular-nums">#{contract.stationId}</span>,
                  que não existe mais no Metabase. Este caso aparece na fila de
                  irregularidades em revisão.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <StatusBadge color="grey" outline>
                  Sem estação
                </StatusBadge>
                <p className="text-sm text-muted-foreground">
                  Nenhuma estação vinculada a este cadastro.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            {contract.observations ? (
              <p className="text-sm whitespace-pre-line">
                {contract.observations}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sem observações.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-6 mb-3 text-lg font-semibold tracking-tight">
        Cobranças de aluguel
      </h2>
      <RentChargesTable
        rows={chargeRows}
        csvFilename={`contrato-${id}-cobrancas`}
      />
    </div>
  );
}
