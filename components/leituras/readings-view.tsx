"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Camera, Check, ExternalLink, Minus } from "lucide-react";

import { DataTable } from "@/components/vammo/data-table";
import { StatCard } from "@/components/vammo/stat-card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AuditByline } from "@/components/vammo/audit-byline";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ReadingRow } from "./readings-read";

/** Days-since threshold that turns the cell red (spec §7). */
const STALE_DAYS = 35;

interface StationMeta {
  name: string | null;
  address: string | null;
}

/** SP-local `YYYY-MM-DD` today, stable within a render. */
function saoPauloToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Enumerate the last `count` competências (first-of-month ISO), newest first. */
function lastCompetencias(todayIso: string, count: number): string[] {
  const [y, m] = todayIso.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${d.getUTCFullYear()}-${mm}-01`);
  }
  return out;
}

function stationLabel(id: number, meta: StationMeta | undefined): string {
  return meta?.name ? `${id} — ${meta.name}` : `${id}`;
}

/** Photo + fields shown in every reading detail popover (table + matrix). */
function ReadingDetail({ reading }: { reading: ReadingRow }) {
  const src = `/api/files/${reading.photoDocumentId}`;
  return (
    <div className="space-y-2.5">
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="group block overflow-hidden rounded-lg border border-border bg-muted"
        title="Abrir foto em tamanho real"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated Drive proxy; next/image cannot sign the request */}
        <img
          src={src}
          alt={`Foto do medidor — ${reading.name}`}
          loading="lazy"
          className="max-h-56 w-full bg-muted object-contain transition group-hover:opacity-90"
        />
      </a>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Leitura</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatNumber(reading.readingKwh)} kWh
        </dd>
        <dt className="text-muted-foreground">Data</dt>
        <dd className="text-right tabular-nums">
          {formatDate(reading.readingDate)}
        </dd>
        <dt className="text-muted-foreground">Nome</dt>
        <dd className="truncate text-right" title={reading.name}>
          {reading.name}
        </dd>
        {reading.notes ? (
          <>
            <dt className="text-muted-foreground">Notas</dt>
            <dd className="text-right">{reading.notes}</dd>
          </>
        ) : null}
      </dl>
      {reading.photoWarnings.length > 0 ? (
        <ul className="space-y-0.5 rounded-md bg-warning-subtle/40 p-2 text-xs text-warning-emphasis">
          {reading.photoWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      <AuditByline actorEmail={reading.readByEmail} at={reading.createdAt} />
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-info-emphasis underline-offset-2 hover:underline"
      >
        Ver foto
        <ExternalLink className="size-3" strokeWidth={2} />
      </a>
    </div>
  );
}

export function ReadingsView({
  readings,
  stationsById,
}: {
  readings: ReadingRow[];
  stationsById: Record<number, StationMeta>;
}) {
  const today = React.useMemo(saoPauloToday, []);
  const currentCompetencia = `${today.slice(0, 7)}-01`;

  // Readings arrive newest-first; group per station keeping that order.
  const byStation = React.useMemo(() => {
    const map = new Map<number, ReadingRow[]>();
    for (const r of readings) {
      const list = map.get(r.stationId);
      if (list) list.push(r);
      else map.set(r.stationId, [r]);
    }
    return map;
  }, [readings]);

  const latestRows = React.useMemo(() => {
    return [...byStation.entries()]
      .map(([stationId, list]) => {
        const latest = list[0];
        const previous = list[1] ?? null;
        const delta =
          previous !== null ? latest.readingKwh - previous.readingKwh : null;
        return { stationId, latest, delta };
      })
      .sort((a, b) => a.stationId - b.stationId);
  }, [byStation]);

  const months = React.useMemo(() => lastCompetencias(today, 6), [today]);

  const kpis = React.useMemo(() => {
    let lidas = 0;
    for (const list of byStation.values()) {
      if (list.some((r) => r.competencia === currentCompetencia)) lidas += 1;
    }
    const comLeitura = byStation.size;
    return {
      lidas,
      pendentes: Math.max(0, comLeitura - lidas),
      comLeitura,
    };
  }, [byStation, currentCompetencia]);

  const columns = React.useMemo<ColumnDef<(typeof latestRows)[number], unknown>[]>(
    () => [
      {
        id: "estacao",
        header: "Estação",
        accessorFn: (r) => stationLabel(r.stationId, stationsById[r.stationId]),
        sortingFn: (a, b) => a.original.stationId - b.original.stationId,
        cell: ({ row }) => (
          <Link
            href={`/estacoes/${row.original.stationId}`}
            className="font-medium text-foreground hover:underline"
          >
            <span className="tabular-nums">{row.original.stationId}</span>
            {stationsById[row.original.stationId]?.name
              ? ` — ${stationsById[row.original.stationId]?.name}`
              : ""}
          </Link>
        ),
      },
      {
        id: "ultimaLeitura",
        header: "Última leitura",
        accessorFn: (r) => r.latest.readingKwh,
        cell: ({ row }) => (
          <span className="block text-right font-medium tabular-nums">
            {formatNumber(row.original.latest.readingKwh)} kWh
          </span>
        ),
      },
      {
        id: "data",
        header: "Data",
        accessorFn: (r) => r.latest.readingDate,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDate(row.original.latest.readingDate)}
          </span>
        ),
      },
      {
        id: "diasDesde",
        header: "Dias desde",
        accessorFn: (r) => daysBetween(r.latest.readingDate, today),
        cell: ({ row }) => {
          const days = daysBetween(row.original.latest.readingDate, today);
          return (
            <span
              className={cn(
                "block text-right tabular-nums",
                days > STALE_DAYS && "font-semibold text-error",
              )}
            >
              {days}
            </span>
          );
        },
      },
      {
        id: "consumoMes",
        header: "Consumo no mês",
        accessorFn: (r) => r.delta ?? Number.MIN_SAFE_INTEGER,
        cell: ({ row }) => {
          const delta = row.original.delta;
          if (delta === null) {
            return <span className="block text-right text-muted-foreground">—</span>;
          }
          return (
            <span className="block text-right tabular-nums">
              {delta >= 0 ? "+" : "−"}
              {formatNumber(Math.abs(delta))} kWh
            </span>
          );
        },
      },
      {
        id: "registradoPor",
        header: "Registrado por",
        accessorFn: (r) => r.latest.readByEmail,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.latest.readByEmail}
          </span>
        ),
      },
      {
        id: "detalhes",
        header: "Detalhes",
        enableSorting: false,
        accessorFn: () => "",
        cell: ({ row }) => (
          <Popover>
            <PopoverTrigger
              render={<Button variant="outline" size="sm" className="h-7 bg-card" />}
            >
              <Camera className="size-3.5" strokeWidth={2} />
              Ver foto
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <ReadingDetail reading={row.original.latest} />
            </PopoverContent>
          </Popover>
        ),
      },
    ],
    [stationsById, today],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Lidas este mês"
          value={kpis.lidas}
          tone={kpis.lidas > 0 ? "success" : "default"}
          sub="estações com leitura no mês corrente"
        />
        <StatCard
          label="Pendentes este mês"
          value={kpis.pendentes}
          tone={kpis.pendentes > 0 ? "warning" : "default"}
          sub="com histórico, sem leitura no mês"
        />
        <StatCard
          label="Estações com leitura"
          value={kpis.comLeitura}
          sub="total com ao menos uma leitura"
        />
      </div>

      <div>
        <h2 className="pb-2 text-sm font-semibold text-foreground">
          Última leitura por estação{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            ({latestRows.length})
          </span>
        </h2>
        <DataTable
          columns={columns}
          data={latestRows}
          searchPlaceholder="Buscar estação ou responsável…"
          initialSorting={[{ id: "diasDesde", desc: true }]}
          csvFilename="leituras-por-estacao"
          emptyMessage="Nenhuma leitura registrada ainda."
        />
      </div>

      {latestRows.length > 0 ? (
        <CompletenessMatrix
          months={months}
          rows={latestRows.map((r) => r.stationId)}
          byStation={byStation}
          stationsById={stationsById}
          currentCompetencia={currentCompetencia}
        />
      ) : null}
    </div>
  );
}

function CompletenessMatrix({
  months,
  rows,
  byStation,
  stationsById,
  currentCompetencia,
}: {
  months: string[];
  rows: number[];
  byStation: Map<number, ReadingRow[]>;
  stationsById: Record<number, StationMeta>;
  currentCompetencia: string;
}) {
  return (
    <div>
      <h2 className="pb-2 text-sm font-semibold text-foreground">
        Completude mensal{" "}
        <span className="font-normal text-muted-foreground">
          (últimos 6 meses)
        </span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Estação
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className={cn(
                    "px-3 py-2 text-center text-xs font-medium whitespace-nowrap tabular-nums",
                    m === currentCompetencia
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {formatMonthShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((stationId) => {
              const list = byStation.get(stationId) ?? [];
              const byMonth = new Map<string, ReadingRow>();
              for (const r of list) {
                if (!byMonth.has(r.competencia)) byMonth.set(r.competencia, r);
              }
              return (
                <tr key={stationId} className="border-b border-border last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/estacoes/${stationId}`}
                      className="font-medium hover:underline"
                    >
                      <span className="tabular-nums">{stationId}</span>
                      {stationsById[stationId]?.name
                        ? ` — ${stationsById[stationId]?.name}`
                        : ""}
                    </Link>
                  </td>
                  {months.map((m) => {
                    const reading = byMonth.get(m);
                    return (
                      <td key={m} className="px-3 py-1.5 text-center">
                        {reading ? (
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  className="inline-flex size-6 items-center justify-center rounded-full text-success-emphasis transition hover:bg-muted"
                                  title={`Ver leitura de ${formatDate(reading.readingDate)}`}
                                />
                              }
                            >
                              <Check className="size-4" strokeWidth={2.5} />
                            </PopoverTrigger>
                            <PopoverContent align="center" className="w-72">
                              <ReadingDetail reading={reading} />
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <Minus
                            className="mx-auto size-4 text-error/60"
                            strokeWidth={2}
                            aria-label="sem leitura"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PT_MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

function formatMonthShort(iso: string): string {
  const [y, m] = iso.split("-");
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${PT_MONTHS_SHORT[idx]}/${y.slice(2)}`;
}
