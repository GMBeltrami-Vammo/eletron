"use client";

/**
 * ARQIA dashboard (Gabriel 2026-07-22): KPIs + gráfico do uso do mês + painel de
 * alertas + botões "Adicionar dados móveis no mês" e "Sincronizar agora".
 * Consome o que `getArqiaData` devolve; escritas via app/actions/arqia.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CircleAlert, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { createArqiaDataPurchase, syncArqiaNow } from "@/app/actions/arqia";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard, type StatTone } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ArqiaData } from "@/app/(app)/arqia/queries";

const gb = (mb: number | null | undefined): string =>
  mb == null ? "—" : `${(mb / 1024).toFixed(2)} GB`;

function usageTone(pct: number): StatTone {
  if (pct >= 90) return "error";
  if (pct >= 70) return "warning";
  return "success";
}

export function ArqiaView({ data, isOperator }: { data: ArqiaData; isOperator: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [addOpen, setAddOpen] = React.useState(false);
  const [mb, setMb] = React.useState("");
  const [note, setNote] = React.useState("");

  const latest = data.latest;

  function addData() {
    const value = Number(mb.replace(/\./g, "").replace(",", "."));
    if (!(value > 0)) {
      toast.error("Informe os MB comprados (> 0).");
      return;
    }
    startTransition(async () => {
      const res = await createArqiaDataPurchase({ mb: value, note: note.trim() || null });
      if (res.ok) {
        toast.success("Dados adicionados ao limite do mês.");
        setAddOpen(false);
        setMb("");
        setNote("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function sync() {
    startTransition(async () => {
      const res = await syncArqiaNow();
      if (res.ok) {
        toast.success("Sincronização concluída.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const chartData = data.monthSeries.map((s) => ({
    day: Number(s.snapshotOn.slice(8, 10)),
    consumo: Number((s.consumptionMb / 1024).toFixed(3)),
    limite: Number((s.effectiveQuotaMb / 1024).toFixed(3)),
    pct: s.pct,
  }));

  return (
    <div className="space-y-4">
      {!data.configured.arqia ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--badge-orange-bg)] bg-warning-subtle px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--badge-orange-bg)]" strokeWidth={2} />
          <span>
            Integração Arqia não configurada — defina as variáveis <code>ARQIA_*</code> no Vercel
            (e <code>SLACK_BOT_TOKEN</code> para os alertas). Até lá a sincronização diária fica em espera.
          </span>
        </div>
      ) : null}

      {/* Ações */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isOperator ? (
          <>
            <Button variant="outline" onClick={() => setAddOpen(true)} disabled={pending}>
              <Plus className="size-4" strokeWidth={2} />
              Adicionar dados móveis no mês
            </Button>
            <Button variant="outline" onClick={sync} disabled={pending}>
              <RefreshCw className="size-4" strokeWidth={2} />
              Sincronizar agora
            </Button>
          </>
        ) : null}
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="SIMs ativos" value={data.activeSimCount.toLocaleString("pt-BR")} />
        <StatCard label="Limite do mês" value={gb(latest?.effectiveQuotaMb)} sub={
          latest ? `${gb(latest.baseQuotaMb)} base + ${gb(latest.purchasedMb)} comprado` : undefined
        } />
        <StatCard label="Consumo" value={gb(latest?.consumptionMb)} />
        <StatCard
          label="Uso"
          value={latest ? `${latest.pct.toFixed(1)}%` : "—"}
          tone={latest ? usageTone(latest.pct) : "default"}
        />
        <StatCard
          label="Comprado no mês"
          value={gb(data.purchasedThisMonthMb)}
          sub={`${data.purchases.length} compra(s)`}
        />
      </div>

      {/* Gráfico */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uso do mês (consumo vs limite)</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis
                  yAxisId="gb"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={48}
                  tickFormatter={(v: number) => `${v} GB`}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={40}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--popover-foreground)",
                    fontSize: "12px",
                  }}
                  labelFormatter={(d) => `Dia ${d}`}
                />
                <Legend />
                <Area
                  yAxisId="gb"
                  name="Consumo"
                  dataKey="consumo"
                  stroke="var(--chart-3)"
                  fill="var(--chart-3)"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Line
                  yAxisId="gb"
                  name="Limite"
                  dataKey="limite"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="pct"
                  name="Uso %"
                  dataKey="pct"
                  stroke="var(--chart-4)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sem snapshots ainda — o primeiro aparece após a próxima sincronização.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Alertas + compras */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alertas enviados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Nenhum alerta disparado.</p>
            ) : (
              data.alerts.map((a) => (
                <div key={a.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {a.pct.toFixed(1)}% · {formatDate(a.snapshotOn)}
                    </span>
                    <StatusBadge color={a.slackOk ? "green" : "grey"} outline>
                      {a.slackOk ? `Slack ✓ (${a.sentTo.length})` : "Slack ✗"}
                    </StatusBadge>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                    {a.message}
                  </pre>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados comprados no mês</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.purchases.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Nenhuma compra registrada neste mês.
              </p>
            ) : (
              data.purchases.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium tabular-nums">{gb(p.mbAdded)}</span>
                    {p.note ? (
                      <span className="text-muted-foreground"> · {p.note}</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(p.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog: adicionar dados móveis */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar dados móveis no mês</DialogTitle>
            <DialogDescription>
              Quantos MB foram comprados? O valor soma ao limite do mês corrente (reseta no
              próximo mês).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="arqia-mb">MB comprados</Label>
              <Input
                id="arqia-mb"
                inputMode="decimal"
                placeholder="Ex.: 5120 (= 5 GB)"
                value={mb}
                onChange={(e) => setMb(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="arqia-note">Nota (opcional)</Label>
              <Input
                id="arqia-note"
                placeholder="Ex.: pacote extra comprado na Arqia"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancelar
            </DialogClose>
            <Button onClick={addData} disabled={pending}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
