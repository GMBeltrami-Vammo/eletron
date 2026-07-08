"use client";

import { Check, ExternalLink, TriangleAlert, Zap } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ColumnDef } from "@tanstack/react-table";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  ACCOUNT_TYPE_UI,
  AUTO_DEBIT_UI,
  CHARGE_STATUS_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";
import {
  formatBRL,
  formatCompetencia,
  formatDate,
  formatNumber,
} from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";
import type { Charge, ChargeEnergyDetails } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { EmptyState } from "./empty-state";
import {
  accountKeyLabel,
  CARRIED_FORWARD_NOTE,
  daysUntil,
  isEnergyAccount,
  monthKey,
} from "./helpers";

type InvoiceRow = { charge: Charge; details: ChargeEnergyDetails | null };

export function EnergyTab({
  data,
  fetchedAt,
}: {
  data: Station360;
  fetchedAt: string;
}) {
  const now = new Date(fetchedAt);
  const energyAccounts = data.accounts.filter((a) =>
    isEnergyAccount(a.account.accountType),
  );
  const detailsByCharge = new Map(
    data.energyDetails.map((d) => [d.chargeId, d]),
  );

  if (energyAccounts.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="Nenhuma instalação de energia vinculada"
        description="Instalações Enel/EDP aparecem aqui quando o scraper as vincula a esta estação."
      />
    );
  }

  return (
    <div className="space-y-4">
      {energyAccounts.map((entry) => (
        <InstallationCard
          key={entry.account.id}
          entry={entry}
          detailsByCharge={detailsByCharge}
          now={now}
        />
      ))}
    </div>
  );
}

function InstallationCard({
  entry,
  detailsByCharge,
  now,
}: {
  entry: Station360["accounts"][number];
  detailsByCharge: Map<string, ChargeEnergyDetails>;
  now: Date;
}) {
  const { account, state, charges, consumption } = entry;
  const typeUi = ACCOUNT_TYPE_UI[account.accountType];
  const keyLabel = accountKeyLabel(entry);

  const shutdownDays =
    state?.shutdownDate != null ? daysUntil(state.shutdownDate, now) : null;
  const shutdownSoon =
    shutdownDays !== null && shutdownDays >= 0 && shutdownDays <= 7;

  // --- Consumption matrix: months as columns, newest left. ---
  const chargeByMonth = new Map<string, Charge>();
  for (const charge of charges) {
    const key = monthKey(charge.competencia);
    if (key && !chargeByMonth.has(key)) chargeByMonth.set(key, charge);
  }
  const consumptionByMonth = new Map(
    consumption
      .map((c) => [monthKey(c.competencia), c] as const)
      .filter((pair): pair is [string, (typeof consumption)[number]] => pair[0] !== null),
  );
  const matrixMonths = Array.from(
    new Set([...consumptionByMonth.keys(), ...chargeByMonth.keys()]),
  )
    .sort()
    .reverse()
    .slice(0, 13);

  // --- Invoice table rows (newest first). ---
  const invoiceRows: InvoiceRow[] = [...charges]
    .sort((a, b) =>
      (b.dueDate ?? b.competencia ?? "").localeCompare(
        a.dueDate ?? a.competencia ?? "",
      ),
    )
    .map((charge) => ({
      charge,
      details: detailsByCharge.get(charge.id) ?? null,
    }));

  // --- kWh × R$ chart, oldest → newest, last 13 months with data. ---
  const chartMonths = Array.from(
    new Set([...consumptionByMonth.keys(), ...chargeByMonth.keys()]),
  )
    .sort()
    .slice(-13);
  const chartData = chartMonths.map((m) => ({
    label: formatCompetencia(`${m}-01`),
    kwh: consumptionByMonth.get(m)?.kwhBilled ?? null,
    valor: chargeByMonth.get(m)?.amount ?? null,
  }));

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge color={typeUi.color}>
            <Zap className="size-3" strokeWidth={2} aria-hidden />
            {typeUi.label}
          </StatusBadge>
          <span className="font-mono text-sm font-semibold">{keyLabel}</span>
          {state?.billStatus ? (
            <span
              title={
                state.isStatusCarriedForward ? CARRIED_FORWARD_NOTE : undefined
              }
            >
              <StatusBadge color={UTILITY_BILL_STATUS_UI[state.billStatus].color}>
                {UTILITY_BILL_STATUS_UI[state.billStatus].label}
              </StatusBadge>
            </span>
          ) : null}
          <StatusBadge color={AUTO_DEBIT_UI[state?.autoDebit ?? "desconhecido"].color}>
            DA: {AUTO_DEBIT_UI[state?.autoDebit ?? "desconhecido"].label}
          </StatusBadge>
          {state?.autoDebitRegistration ? (
            <span className="text-xs text-muted-foreground">
              {state.autoDebitRegistration}
            </span>
          ) : null}
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {state?.accountEmail ?? ""}
          </span>
        </div>
        {state?.providerStationStatus ? (
          <p className="text-xs text-muted-foreground">
            Portal: {state.providerStationStatus}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Shutdown banner */}
        {shutdownSoon && state ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--badge-orange-bg)] bg-warning-subtle px-3 py-2 text-sm">
            <TriangleAlert
              className="size-4 shrink-0 text-[var(--badge-orange-bg)]"
              strokeWidth={2}
              aria-hidden
            />
            <span>
              Desligamento programado em{" "}
              <strong className="tabular-nums">
                {formatDate(state.shutdownDate)}
              </strong>
              {state.shutdownStart && state.shutdownEnd ? (
                <>
                  {" "}
                  ({state.shutdownStart}–{state.shutdownEnd})
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        {/* Key figures row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Figure label="Última fatura">
            <span className="tabular-nums">{formatBRL(state?.lastBilling)}</span>
          </Figure>
          <Figure label="Vencimento">
            <span className="tabular-nums">{formatDate(state?.dueDate)}</span>
          </Figure>
          {state && state.negotiatedCompetencias.length > 0 ? (
            <Figure label="Negociadas">
              <span className="flex flex-wrap gap-1">
                {state.negotiatedCompetencias.map((c) => (
                  <StatusBadge key={c} color="orange">
                    {formatCompetencia(`${c}-01`)}
                  </StatusBadge>
                ))}
              </span>
            </Figure>
          ) : null}
        </div>

        {/* Consumption history matrix */}
        {matrixMonths.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                    Consumo
                  </th>
                  {matrixMonths.map((m) => (
                    <th
                      key={m}
                      className="px-2 py-1.5 text-right text-xs font-medium whitespace-nowrap text-muted-foreground"
                    >
                      {formatCompetencia(`${m}-01`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <MatrixRow
                  label="kWh faturado (F)"
                  months={matrixMonths}
                  divergence={(m) => isDivergent(consumptionByMonth.get(m))}
                  render={(m) =>
                    formatNumber(consumptionByMonth.get(m)?.kwhBilled)
                  }
                />
                <MatrixRow
                  label="kWh registrado (R)"
                  months={matrixMonths}
                  divergence={(m) => isDivergent(consumptionByMonth.get(m))}
                  render={(m) =>
                    formatNumber(consumptionByMonth.get(m)?.kwhRecorded)
                  }
                />
                <MatrixRow
                  label="Valor (R$)"
                  months={matrixMonths}
                  render={(m) => formatBRL(chargeByMonth.get(m)?.amount)}
                />
                <tr>
                  <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
                    Status
                  </td>
                  {matrixMonths.map((m) => {
                    const charge = chargeByMonth.get(m);
                    return (
                      <td key={m} className="px-2 py-1.5 text-right whitespace-nowrap">
                        {charge ? (
                          <StatusBadge color={CHARGE_STATUS_UI[charge.status].color}>
                            {CHARGE_STATUS_UI[charge.status].label}
                          </StatusBadge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sem histórico de consumo coletado.
          </p>
        )}

        {/* Invoice table */}
        <DataTable<InvoiceRow>
          columns={invoiceColumns}
          data={invoiceRows}
          csvFilename={`faturas-${keyLabel.replaceAll(" ", "-").toLowerCase()}`}
          pageSize={12}
          searchPlaceholder="Buscar fatura…"
          emptyMessage="Nenhuma fatura coletada ainda."
        />

        {/* kWh × R$ chart */}
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                yAxisId="kwh"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={52}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              <YAxis
                yAxisId="brl"
                orientation="right"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={72}
                tickFormatter={(v: number) => formatBRL(v)}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--popover-foreground)",
                  fontSize: "12px",
                }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                formatter={(value, name) =>
                  name === "R$"
                    ? formatBRL(Number(value))
                    : `${formatNumber(Number(value))} kWh`
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="kwh"
                dataKey="kwh"
                name="kWh"
                fill="var(--chart-3)"
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="brl"
                dataKey="valor"
                name="R$"
                stroke="var(--chart-2)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

/** F vs R divergence above 15% → error-subtle cell tint (live audit signal). */
function isDivergent(
  mc: { kwhBilled: number | null; kwhRecorded: number | null } | undefined,
): boolean {
  if (!mc || mc.kwhBilled === null || mc.kwhRecorded === null) return false;
  if (mc.kwhBilled === 0) return mc.kwhRecorded !== 0;
  return Math.abs(mc.kwhBilled - mc.kwhRecorded) / mc.kwhBilled > 0.15;
}

function MatrixRow({
  label,
  months,
  render,
  divergence,
}: {
  label: string;
  months: string[];
  render: (month: string) => string;
  divergence?: (month: string) => boolean;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
        {label}
      </td>
      {months.map((m) => (
        <td
          key={m}
          className={cn(
            "px-2 py-1.5 text-right whitespace-nowrap tabular-nums",
            divergence?.(m) && "bg-error-subtle",
          )}
        >
          {render(m)}
        </td>
      ))}
    </tr>
  );
}

function num(cellValue: string | React.ReactNode): React.ReactNode {
  return <span className="block text-right tabular-nums">{cellValue}</span>;
}

const invoiceColumns: ColumnDef<InvoiceRow, unknown>[] = [
  {
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (r) => r.charge.dueDate ?? "",
    cell: ({ row }) => num(formatDate(row.original.charge.dueDate)),
    meta: { csvValue: (r: InvoiceRow) => r.charge.dueDate ?? "" },
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (r) => r.charge.amount ?? 0,
    cell: ({ row }) => num(formatBRL(row.original.charge.amount)),
    meta: { csvValue: (r: InvoiceRow) => r.charge.amount ?? "" },
  },
  {
    id: "nf",
    header: "NF",
    accessorFn: (r) => r.details?.nf ?? "",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.details?.nf ?? "—"}</span>
    ),
  },
  {
    id: "tusd",
    header: "TUSD",
    accessorFn: (r) => r.details?.tusdAmount ?? 0,
    cell: ({ row }) => {
      const d = row.original.details;
      if (!d || (d.tusdKwh === null && d.tusdAmount === null)) return num("—");
      return num(`${formatNumber(d.tusdKwh)} kWh · ${formatBRL(d.tusdAmount)}`);
    },
    meta: { csvValue: (r: InvoiceRow) => r.details?.tusdAmount ?? "" },
  },
  {
    id: "te",
    header: "TE",
    accessorFn: (r) => r.details?.teAmount ?? 0,
    cell: ({ row }) => {
      const d = row.original.details;
      if (!d || (d.teKwh === null && d.teAmount === null)) return num("—");
      return num(`${formatNumber(d.teKwh)} kWh · ${formatBRL(d.teAmount)}`);
    },
    meta: { csvValue: (r: InvoiceRow) => r.details?.teAmount ?? "" },
  },
  {
    id: "cip",
    header: "CIP",
    accessorFn: (r) => r.details?.cip ?? 0,
    cell: ({ row }) => num(formatBRL(row.original.details?.cip)),
    meta: { csvValue: (r: InvoiceRow) => r.details?.cip ?? "" },
  },
  {
    id: "total",
    header: "Total",
    accessorFn: (r) => r.details?.total ?? 0,
    cell: ({ row }) => num(formatBRL(row.original.details?.total)),
    meta: { csvValue: (r: InvoiceRow) => r.details?.total ?? "" },
  },
  {
    id: "leituras",
    header: "Leituras",
    accessorFn: (r) =>
      `${r.details?.leituraAnterior ?? ""} ${r.details?.leituraAtual ?? ""}`.trim(),
    cell: ({ row }) => {
      const d = row.original.details;
      if (!d || (d.leituraAnterior === null && d.leituraAtual === null)) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="tabular-nums">
          {d.leituraAnterior ?? "—"} → {d.leituraAtual ?? "—"}
        </span>
      );
    },
  },
  {
    id: "tarifa",
    header: "Tarifa",
    accessorFn: (r) => tariffLabel(r.details),
    cell: ({ row }) => {
      const label = tariffLabel(row.original.details);
      return label ? (
        <span className="text-xs">{label}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    id: "financeiro",
    header: "Financeiro",
    accessorFn: (r) => (r.details?.financeiroCheck ? "sim" : "não"),
    // Phase 1 is read-only: the human 'paid' checkbox renders as a static icon.
    cell: ({ row }) =>
      row.original.details?.financeiroCheck ? (
        <span title="Financeiro check (somente leitura na fase 1)">
          <Check
            className="mx-auto size-4 text-success-emphasis"
            strokeWidth={2}
            aria-label="Conferido pelo financeiro"
          />
        </span>
      ) : (
        <span className="block text-center text-muted-foreground">—</span>
      ),
  },
  {
    id: "fatura",
    header: "Fatura",
    enableSorting: false,
    accessorFn: (r) => r.details?.faturaDriveUrl ?? "",
    cell: ({ row }) =>
      row.original.details?.faturaDriveUrl ? (
        <a
          href={row.original.details.faturaDriveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-info-emphasis hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Ver fatura
          <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

function tariffLabel(details: ChargeEnergyDetails | null): string {
  if (!details) return "";
  const enel = [
    details.tariffC1,
    details.tariffC2,
    details.tariffC3,
    details.tariffC4,
    details.tariffC5,
    details.tariffC6,
  ]
    .filter((v): v is string => v !== null && v !== "")
    .join(" · ");
  if (enel) return enel;
  return [details.classificacao, details.modalidade]
    .filter((v): v is string => v !== null && v !== "")
    .join(" · ");
}
