"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  ACCOUNT_TYPE_UI,
  ALERT_TYPE_UI,
  CHARGE_STATUS_UI,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";
import type { Charge } from "@/lib/domain";

import {
  accountKeyLabel,
  alertDetail,
  CARRIED_FORWARD_NOTE,
  isEnergyAccount,
  lastMonthKeys,
  latestCharge,
  monthKey,
} from "./helpers";

const OPEN_CHARGE_STATUSES = new Set<Charge["status"]>([
  "pendente",
  "boleto_recebido",
  "atrasado",
  "em_compensacao",
  "negociada",
]);

export function OverviewTab({
  data,
  fetchedAt,
}: {
  data: Station360;
  fetchedAt: string;
}) {
  const now = new Date(fetchedAt);
  const linesByCharge = new Map<string, Station360["chargeLines"]>();
  for (const line of data.chargeLines) {
    const list = linesByCharge.get(line.chargeId) ?? [];
    list.push(line);
    linesByCharge.set(line.chargeId, list);
  }

  // 12-month stacked cost series (energy = chart-1, rent = chart-5).
  const months = lastMonthKeys(now, 12);
  const buckets = new Map<string, { energia: number; aluguel: number }>(
    months.map((m) => [m, { energia: 0, aluguel: 0 }]),
  );
  for (const charge of data.charges) {
    const key = monthKey(charge.competencia);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (!bucket || charge.amount === null) continue;
    if (charge.kind === "energia") {
      bucket.energia += charge.amount;
    } else if (charge.kind === "aluguel") {
      bucket.aluguel += charge.amount;
    } else {
      // aluguel_energia: split via charge_lines when present, rent otherwise.
      const lines = linesByCharge.get(charge.id) ?? [];
      if (lines.length > 0) {
        for (const line of lines) {
          if (line.lineKind === "energia") bucket.energia += line.amount;
          else bucket.aluguel += line.amount;
        }
      } else {
        bucket.aluguel += charge.amount;
      }
    }
  }
  const chartData = months.map((m) => ({
    label: formatCompetencia(`${m}-01`),
    energia: Math.round((buckets.get(m)?.energia ?? 0) * 100) / 100,
    aluguel: Math.round((buckets.get(m)?.aluguel ?? 0) * 100) / 100,
  }));
  const hasChartData = chartData.some((d) => d.energia > 0 || d.aluguel > 0);

  // Open items: utility states not paga + rent charges not pago.
  const openUtility = data.accounts.flatMap((entry) => {
    if (!isEnergyAccount(entry.account.accountType)) return [];
    const state = entry.state;
    if (
      !state ||
      state.billStatus === null ||
      state.billStatus === "paga" ||
      state.billStatus === "na"
    ) {
      return [];
    }
    return [{ entry, state, billStatus: state.billStatus }];
  });
  const openRentCharges = data.charges.filter(
    (c) => c.kind !== "energia" && OPEN_CHARGE_STATUSES.has(c.status),
  );

  return (
    <div className="space-y-4">
      {/* (a) Compact billing-account cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.accounts.map((entry) => {
          const { account, state } = entry;
          const isEnergy = isEnergyAccount(account.accountType);
          const last = latestCharge(entry.charges);
          const statusBadge = isEnergy ? (
            state?.billStatus ? (
              <span
                title={
                  state.isStatusCarriedForward ? CARRIED_FORWARD_NOTE : undefined
                }
              >
                <StatusBadge color={UTILITY_BILL_STATUS_UI[state.billStatus].color}>
                  {UTILITY_BILL_STATUS_UI[state.billStatus].label}
                </StatusBadge>
              </span>
            ) : (
              <StatusBadge color="grey" outline>
                Sem status
              </StatusBadge>
            )
          ) : last ? (
            <StatusBadge color={CHARGE_STATUS_UI[last.status].color}>
              {CHARGE_STATUS_UI[last.status].label}
            </StatusBadge>
          ) : (
            <StatusBadge color="grey" outline>
              Sem cobranças
            </StatusBadge>
          );

          const lastValue = isEnergy ? (state?.lastBilling ?? null) : (last?.amount ?? null);
          const dueDate = isEnergy ? (state?.dueDate ?? null) : (last?.dueDate ?? null);

          return (
            <Card key={account.id} size="sm">
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge color={ACCOUNT_TYPE_UI[account.accountType].color}>
                    {ACCOUNT_TYPE_UI[account.accountType].label}
                  </StatusBadge>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {accountKeyLabel(entry)}
                  </span>
                  <span className="ml-auto">{statusBadge}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Última fatura
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {formatBRL(lastValue)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Vencimento
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {formatDate(dueDate)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* (b) 12-month stacked cost chart */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Custo mensal — últimos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          {hasChartData ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={72}
                  tickFormatter={(v: number) => formatBRL(v)}
                />
                <RechartsTooltip
                  formatter={(value) => formatBRL(Number(value))}
                  labelClassName="text-xs"
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="energia"
                  name="Energia"
                  stackId="custo"
                  fill="var(--chart-1)"
                />
                <Bar
                  dataKey="aluguel"
                  name="Aluguel"
                  stackId="custo"
                  fill="var(--chart-5)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma cobrança com competência nos últimos 12 meses.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* (c) Open items */}
        <Card size="sm">
          <CardHeader>
            <CardTitle>Itens em aberto</CardTitle>
          </CardHeader>
          <CardContent>
            {openUtility.length === 0 && openRentCharges.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Nada em aberto para esta estação.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {openUtility.map(({ entry, state, billStatus }) => (
                  <li
                    key={entry.account.id}
                    className="flex flex-wrap items-center gap-2 py-2"
                  >
                    <span
                      title={
                        state.isStatusCarriedForward
                          ? CARRIED_FORWARD_NOTE
                          : undefined
                      }
                    >
                      <StatusBadge color={UTILITY_BILL_STATUS_UI[billStatus].color}>
                        {UTILITY_BILL_STATUS_UI[billStatus].label}
                      </StatusBadge>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {accountKeyLabel(entry)}
                    </span>
                    {state.isStatusCarriedForward ? (
                      <span className="text-xs text-muted-foreground italic">
                        {CARRIED_FORWARD_NOTE.toLowerCase()}
                      </span>
                    ) : null}
                    <span className="ml-auto text-right tabular-nums">
                      {formatBRL(state.lastBilling)}
                      <span className="block text-xs text-muted-foreground">
                        vence {formatDate(state.dueDate)}
                      </span>
                    </span>
                  </li>
                ))}
                {openRentCharges.map((charge) => (
                  <li
                    key={charge.id}
                    className="flex flex-wrap items-center gap-2 py-2"
                  >
                    <StatusBadge color={CHARGE_STATUS_UI[charge.status].color}>
                      {CHARGE_STATUS_UI[charge.status].label}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      Aluguel · {formatCompetencia(charge.competencia)}
                    </span>
                    <span className="ml-auto text-right tabular-nums">
                      {formatBRL(charge.amount)}
                      <span className="block text-xs text-muted-foreground">
                        vence {formatDate(charge.dueDate)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* (d) Station alerts */}
        <Card size="sm">
          <CardHeader>
            <CardTitle>Alertas da estação</CardTitle>
          </CardHeader>
          <CardContent>
            {data.alerts.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Nenhum alerta ativo.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.alerts.map((alert) => {
                  const ui = ALERT_TYPE_UI[alert.alertType];
                  const detail = alertDetail(alert);
                  return (
                    <li
                      key={alert.id}
                      className="flex flex-wrap items-center gap-2 py-2"
                    >
                      <StatusBadge color={ui?.color ?? "grey"}>
                        {ui?.label ?? alert.alertType}
                      </StatusBadge>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {detail || (ui?.description ?? "")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
